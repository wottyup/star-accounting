import { Capacitor } from "@capacitor/core";
import { hybridNavigation as navigation } from "./hybrid-navigation-bridge";

/** Called after React commits, never in response to an address-bar change. */
export async function reportHybridTabCommit(path: string, requestId = 0) {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("HybridNavigation")) return;
  try {
    await navigation.commitTabNavigation({ path, requestId });
  } catch (error) {
    // An older installed shell may serve newer web assets during development.
    console.warn("Unable to confirm the hybrid tab navigation", error);
  }
}
