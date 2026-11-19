import { Capacitor } from "@capacitor/core";
import { createSheetLayerCoordinator } from "./sheet-layer-coordinator";
import { hybridNavigation as navigation } from "./hybrid-navigation-bridge";

async function prepareNativeSheetLayer() {
  const noop = async () => {};
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("HybridNavigation")) return noop;

  let image: HTMLImageElement | null = null;
  let token: number | null = null;
  const restore = async () => {
    try {
      if (token !== null) await navigation.releaseSheetLayer({ token });
    } finally {
      image?.remove();
    }
  };

  try {
    const captured = await navigation.prepareSheetLayer();
    if (!captured.active) return noop;
    token = captured.token;
    const scale = window.innerWidth / captured.viewportWidth;
    image = new Image();
    image.className = "native-bottom-nav-image";
    image.dataset.starkNativeBottomBar = String(token);
    image.setAttribute("aria-hidden", "true");
    image.alt = "";
    image.draggable = false;
    Object.assign(image.style, {
      width: `${captured.width * scale}px`,
      height: `${captured.height * scale}px`,
      left: `${captured.left * scale}px`,
      bottom: `${captured.bottom * scale}px`,
    });
    image.src = captured.dataUrl;
    await image.decode();
    document.body.appendChild(image);
    // Native waits for this decoded image to reach WebView's compositor.
    // Only then can the panel animate over the matching navigation picture.
    await navigation.commitSheetLayer({ token });
    return restore;
  } catch (error) {
    await restore().catch(() => {});
    console.warn("Unable to prepare the hybrid sheet navigation layer", error);
    return noop;
  }
}

export const acquireSheetNavigationLayer = createSheetLayerCoordinator(prepareNativeSheetLayer);
