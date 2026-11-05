"use client";

import { useEffect, useState } from "react";
import { acquireSheetNavigationLayer } from "@/lib/stark/navigation/native-sheet-layer";

export function useSheetPresentation(mounted = true) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    const layer = acquireSheetNavigationLayer();
    let disposed = false;
    let firstFrame = 0;
    let secondFrame = 0;
    void layer.ready.then(() => {
      if (disposed) return;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if (!disposed) setReady(true);
        });
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      void layer.release();
    };
  }, [mounted]);

  return ready;
}
