package com.sonicsaucepan.app;

import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "NativeMidi")
public class NativeMidiPlugin extends Plugin {
    private static final long OPEN_DEVICE_TIMEOUT_MS = 2000L;

    private final Map<String, OutputConnection> outputConnections = new ConcurrentHashMap<>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Nullable
    private MidiManager midiManager;

    @Nullable
    private MidiManager.DeviceCallback deviceCallback;

    @Override
    public void load() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }

        midiManager = getContext().getSystemService(MidiManager.class);
        if (midiManager == null) {
            return;
        }

        deviceCallback = new MidiManager.DeviceCallback() {
            @Override
            public void onDeviceAdded(MidiDeviceInfo device) {
                emitPortsChanged();
            }

            @Override
            public void onDeviceRemoved(MidiDeviceInfo device) {
                closeConnectionsForDevice(device.getId());
                emitPortsChanged();
            }

            @Override
            public void onDeviceStatusChanged(android.media.midi.MidiDeviceStatus status) {
                emitPortsChanged();
            }
        };

        midiManager.registerDeviceCallback(deviceCallback, mainHandler);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();

        if (midiManager != null && deviceCallback != null) {
            midiManager.unregisterDeviceCallback(deviceCallback);
        }

        for (OutputConnection connection : outputConnections.values()) {
            connection.closeQuietly();
        }
        outputConnections.clear();
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", midiManager != null);
        result.put("platform", "android");
        call.resolve(result);
    }

    @PluginMethod
    public void listOutputs(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ports", buildPortsArray());
        call.resolve(result);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String portId = call.getString("portId");
        JSArray rawData = call.getArray("data");

        if (portId == null || portId.trim().isEmpty()) {
            call.reject("portId is required");
            return;
        }
        if (rawData == null || rawData.length() == 0) {
            call.reject("data must contain at least one MIDI byte");
            return;
        }

        try {
            OutputConnection connection = getOrOpenConnection(portId);
            byte[] data = new byte[rawData.length()];
            for (int index = 0; index < rawData.length(); index += 1) {
                int value = rawData.optInt(index, -1);
                if (value < 0 || value > 255) {
                    call.reject("MIDI byte out of range: " + value);
                    return;
                }
                data[index] = (byte) value;
            }

            connection.inputPort.send(data, 0, data.length);
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    private void emitPortsChanged() {
        JSObject payload = new JSObject();
        payload.put("ports", buildPortsArray());
        notifyListeners("portsChanged", payload, true);
    }

    @NonNull
    private JSArray buildPortsArray() {
        JSArray ports = new JSArray();
        if (midiManager == null) {
            return ports;
        }

        for (MidiDeviceInfo deviceInfo : midiManager.getDevices()) {
            for (MidiDeviceInfo.PortInfo portInfo : deviceInfo.getPorts()) {
                if (portInfo.getType() != MidiDeviceInfo.PortInfo.TYPE_INPUT) {
                    continue;
                }

                JSObject port = new JSObject();
                String id = buildPortId(deviceInfo.getId(), portInfo.getPortNumber());
                port.put("id", id);
                port.put("name", friendlyPortName(deviceInfo, portInfo));
                port.put("manufacturer", deviceInfo.getProperties().getString(MidiDeviceInfo.PROPERTY_MANUFACTURER));
                port.put("product", deviceInfo.getProperties().getString(MidiDeviceInfo.PROPERTY_PRODUCT));
                port.put("deviceId", deviceInfo.getId());
                port.put("portNumber", portInfo.getPortNumber());
                ports.put(port);
            }
        }

        return ports;
    }

    @NonNull
    private OutputConnection getOrOpenConnection(@NonNull String portId) throws Exception {
        OutputConnection existing = outputConnections.get(portId);
        if (existing != null) {
            return existing;
        }

        PortAddress address = PortAddress.parse(portId);
        MidiDeviceInfo deviceInfo = findDeviceInfo(address.deviceId);
        if (deviceInfo == null) {
            throw new IOException("MIDI device not found for port " + portId);
        }

        boolean portExists = false;
        for (MidiDeviceInfo.PortInfo portInfo : deviceInfo.getPorts()) {
            if (portInfo.getType() == MidiDeviceInfo.PortInfo.TYPE_INPUT && portInfo.getPortNumber() == address.portNumber) {
                portExists = true;
                break;
            }
        }
        if (!portExists) {
            throw new IOException("MIDI port is no longer available: " + portId);
        }

        MidiDevice device = openDevice(deviceInfo);
        MidiInputPort inputPort = device.openInputPort(address.portNumber);
        if (inputPort == null) {
            try {
                device.close();
            } catch (IOException ignored) {
            }
            throw new IOException("Failed to open MIDI input port " + portId);
        }

        OutputConnection created = new OutputConnection(address.deviceId, device, inputPort);
        OutputConnection racing = outputConnections.putIfAbsent(portId, created);
        if (racing != null) {
            created.closeQuietly();
            return racing;
        }
        return created;
    }

    @Nullable
    private MidiDeviceInfo findDeviceInfo(int deviceId) {
        if (midiManager == null) {
            return null;
        }
        for (MidiDeviceInfo deviceInfo : midiManager.getDevices()) {
            if (deviceInfo.getId() == deviceId) {
                return deviceInfo;
            }
        }
        return null;
    }

    @NonNull
    private MidiDevice openDevice(@NonNull MidiDeviceInfo deviceInfo) throws Exception {
        if (midiManager == null) {
            throw new IOException("MIDI manager unavailable");
        }

        CountDownLatch latch = new CountDownLatch(1);
        final MidiDevice[] openedDevice = new MidiDevice[1];

        midiManager.openDevice(deviceInfo, device -> {
            openedDevice[0] = device;
            latch.countDown();
        }, mainHandler);

        boolean completed = latch.await(OPEN_DEVICE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        if (!completed) {
            throw new IOException("Timed out opening MIDI device " + deviceInfo.getId());
        }
        if (openedDevice[0] == null) {
            throw new IOException("Failed to open MIDI device " + deviceInfo.getId());
        }
        return openedDevice[0];
    }

    private void closeConnectionsForDevice(int deviceId) {
        outputConnections.entrySet().removeIf((Map.Entry<String, OutputConnection> entry) -> {
            if (entry.getValue().deviceId != deviceId) {
                return false;
            }
            entry.getValue().closeQuietly();
            return true;
        });
    }

    @NonNull
    private static String buildPortId(int deviceId, int portNumber) {
        return deviceId + ":" + portNumber;
    }

    @NonNull
    private static String friendlyPortName(@NonNull MidiDeviceInfo deviceInfo, @NonNull MidiDeviceInfo.PortInfo portInfo) {
        String portName = portInfo.getName();
        if (portName != null && !portName.trim().isEmpty()) {
            return portName;
        }

        String manufacturer = deviceInfo.getProperties().getString(MidiDeviceInfo.PROPERTY_MANUFACTURER);
        String product = deviceInfo.getProperties().getString(MidiDeviceInfo.PROPERTY_PRODUCT);
        if (manufacturer != null && product != null) {
            return manufacturer + " " + product + " " + portInfo.getPortNumber();
        }
        if (product != null) {
            return product + " " + portInfo.getPortNumber();
        }
        return "MIDI " + buildPortId(deviceInfo.getId(), portInfo.getPortNumber());
    }

    private static final class PortAddress {
        final int deviceId;
        final int portNumber;

        private PortAddress(int deviceId, int portNumber) {
            this.deviceId = deviceId;
            this.portNumber = portNumber;
        }

        @NonNull
        static PortAddress parse(@NonNull String raw) throws IOException {
            String[] parts = raw.split(":", 2);
            if (parts.length != 2) {
                throw new IOException("Invalid MIDI port id: " + raw);
            }

            try {
                return new PortAddress(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
            } catch (NumberFormatException error) {
                throw new IOException("Invalid MIDI port id: " + raw, error);
            }
        }
    }

    private static final class OutputConnection {
        final int deviceId;
        final MidiDevice device;
        final MidiInputPort inputPort;

        OutputConnection(int deviceId, @NonNull MidiDevice device, @NonNull MidiInputPort inputPort) {
            this.deviceId = deviceId;
            this.device = device;
            this.inputPort = inputPort;
        }

        void closeQuietly() {
            try {
                inputPort.close();
            } catch (IOException ignored) {
            }
            try {
                device.close();
            } catch (IOException ignored) {
            }
        }
    }
}