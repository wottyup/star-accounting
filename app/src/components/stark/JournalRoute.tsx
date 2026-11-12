"use client";

import { useEffect, useState } from "react";
import { JournalPanel } from "@/components/stark/JournalPanel";
import type { FloatingJournalAction } from "@/lib/stark/floating-journal";
import { SHOWCASE_DEMO_MODE, withAppBasePath } from "@/lib/stark/runtime";

type FloatingJournalOverlayBridge = {
  getPendingAction(): string;
  acknowledgeAction(actionId: string): void;
  close(): void;
};

declare global {
  interface Window {
    AndroidFloatingJournal?: FloatingJournalOverlayBridge;
  }
}

export function JournalRoute({ variant }: { variant?: "journal" | "savings" | "asset" | "loan" }) {
  const [routeReady, setRouteReady] = useState(false);
  const [resolvedVariant, setResolvedVariant] = useState<"journal" | "savings" | "asset" | "loan" | null>(variant ?? null);
  const [preset, setPreset] = useState<{ type: "INCOME"; category: "工资" } | undefined>(() => (
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preset") === "salary"
      ? { type: "INCOME", category: "工资" }
      : undefined
  ));
  const [savingsGoalId, setSavingsGoalId] = useState<string | undefined>(() => {
    if (typeof window === "undefined" || variant !== "savings") return undefined;
    return new URLSearchParams(window.location.search).get("goalId") || undefined;
  });
  const [floatingAction, setFloatingAction] = useState<FloatingJournalAction | null>(null);
  const [floatingOverlay, setFloatingOverlay] = useState(false);

  useEffect(() => {
    if (variant) {
      setResolvedVariant(variant);
      setPreset(undefined);
      setSavingsGoalId(variant === "savings" ? new URLSearchParams(window.location.search).get("goalId") || undefined : undefined);
      setRouteReady(true);
      return;
    }
    const journalVariantKey = SHOWCASE_DEMO_MODE ? "showcase:stark:journal-variant" : "stark:journal-variant";
    setResolvedVariant(window.sessionStorage.getItem(journalVariantKey) === "savings" ? "savings" : "journal");
    setPreset(new URLSearchParams(window.location.search).get("preset") === "salary"
      ? { type: "INCOME", category: "工资" }
      : undefined);
    setSavingsGoalId(undefined);
    setRouteReady(true);
  }, [variant]);

  useEffect(() => {
    const bridge = window.AndroidFloatingJournal;
    if (new URLSearchParams(window.location.search).get("floating") !== "1" || !bridge) return;
    setFloatingOverlay(true);
    try {
      const raw = bridge.getPendingAction();
      if (!raw) return;
      const action = JSON.parse(raw) as Partial<FloatingJournalAction>;
      if (typeof action.actionId !== "string"
        || (action.mode !== "screen" && action.mode !== "upload")) return;
      setFloatingAction({
        actionId: action.actionId,
        mode: action.mode,
        ...(typeof action.imageData === "string" ? { imageData: action.imageData } : {}),
        ...(typeof action.message === "string" ? { message: action.message } : {}),
      });
      bridge.acknowledgeAction(action.actionId);
    } catch {
      // The form remains usable as a manual entry if a pending capture cannot be read.
    }
  }, []);

  if (!routeReady || !resolvedVariant) return null;

  function closePanel() {
    if (floatingOverlay) {
      window.AndroidFloatingJournal?.close();
      return;
    }
    if (resolvedVariant === "savings") {
      window.location.replace(withAppBasePath("/app/savings/"));
      return;
    }
    window.history.back();
  }

  return <JournalPanel mode="page" variant={resolvedVariant} historyMode="route" preset={preset} savingsGoalId={savingsGoalId} floatingAction={floatingAction} onClose={closePanel} onSaved={closePanel} />;
}
