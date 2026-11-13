import { Capacitor, registerPlugin } from "@capacitor/core";

export type FloatingJournalStatus = {
  overlayAllowed: boolean;
  serviceActive: boolean;
};

type FloatingJournalBridge = {
  getStatus(): Promise<FloatingJournalStatus>;
  enableOverlay(): Promise<{ enabled: boolean }>;
  disable(): Promise<void>;
};

const nativeFloatingJournal = registerPlugin<FloatingJournalBridge>("FloatingJournal");

export function isFloatingJournalAvailable() {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("FloatingJournal");
}

export function floatingJournal() {
  return nativeFloatingJournal;
}
