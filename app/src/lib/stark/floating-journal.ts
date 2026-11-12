import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type FloatingJournalAction = {
  actionId: string;
  mode: "screen" | "upload";
  imageData?: string;
  message?: string;
};

export type FloatingJournalStatus = {
  overlayAllowed: boolean;
  serviceActive: boolean;
  captureActive: boolean;
};

type FloatingJournalBridge = {
  getStatus(): Promise<FloatingJournalStatus>;
  enableOverlay(): Promise<{ enabled: boolean }>;
  requestScreenCapture(): Promise<{ enabled: boolean }>;
  stopScreenCapture(): Promise<void>;
  disable(): Promise<void>;
  getPendingAction(): Promise<Partial<FloatingJournalAction>>;
  acknowledgeAction(options: { actionId: string }): Promise<void>;
  selectImage(): Promise<{ canceled: boolean; dataUrl?: string; fileName?: string }>;
  addListener(
    eventName: "journalAction",
    listener: (action: FloatingJournalAction) => void,
  ): Promise<PluginListenerHandle>;
};

const nativeFloatingJournal = registerPlugin<FloatingJournalBridge>("FloatingJournal");

export function isFloatingJournalAvailable() {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("FloatingJournal");
}

export function floatingJournal() {
  return nativeFloatingJournal;
}
