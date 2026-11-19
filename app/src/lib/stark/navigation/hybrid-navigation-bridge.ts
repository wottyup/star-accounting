import { registerPlugin } from "@capacitor/core";

type NavigationImage = {
  active: boolean;
  token: number;
  dataUrl: string;
  width: number;
  height: number;
  viewportWidth: number;
  left: number;
  bottom: number;
};

type HybridNavigation = {
  prepareSheetLayer(): Promise<NavigationImage>;
  commitSheetLayer(options: { token: number }): Promise<void>;
  releaseSheetLayer(options: { token: number }): Promise<void>;
  commitTabNavigation(options: { path: string; requestId: number }): Promise<void>;
};

// Sheets and primary tabs share one Capacitor plugin registration.
export const hybridNavigation = registerPlugin<HybridNavigation>("HybridNavigation");
