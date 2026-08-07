import { registerPlugin } from "@capacitor/core";

export type NativeMidiOutputPort = {
  id: string;
  name: string;
  manufacturer?: string | null;
  product?: string | null;
  deviceId: number;
  portNumber: number;
};

export type NativeMidiAvailability = {
  supported: boolean;
  platform: string;
};

export type NativeMidiPortsResult = {
  ports: NativeMidiOutputPort[];
};

export type NativeMidiPortsChangedEvent = NativeMidiPortsResult;

export interface NativeMidiPlugin {
  isSupported(): Promise<NativeMidiAvailability>;
  listOutputs(): Promise<NativeMidiPortsResult>;
  send(options: { portId: string; data: number[] }): Promise<void>;
  addListener(
    eventName: "portsChanged",
    listenerFunc: (event: NativeMidiPortsChangedEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  removeAllListeners(): Promise<void>;
}

export const NativeMidi = registerPlugin<NativeMidiPlugin>("NativeMidi", {
  web: () => import("./native-midi.web").then((module) => new module.NativeMidiWeb()),
});