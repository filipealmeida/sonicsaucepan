import { WebPlugin } from "@capacitor/core";

import type {
  NativeMidiAvailability,
  NativeMidiPlugin,
  NativeMidiPortsResult,
} from "./native-midi";

export class NativeMidiWeb extends WebPlugin implements NativeMidiPlugin {
  async isSupported(): Promise<NativeMidiAvailability> {
    return {
      supported: false,
      platform: "web",
    };
  }

  async listOutputs(): Promise<NativeMidiPortsResult> {
    return { ports: [] };
  }

  async send(): Promise<void> {
    throw new Error("Native MIDI is unavailable on the web platform");
  }
}