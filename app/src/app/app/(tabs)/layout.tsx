"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileBottomNav } from "@/components/stark/MobileBottomNav";
import { LazyJournalPanel as JournalPanel, preloadJournalPanel } from "@/components/stark/LazyJournalPanel";
import { useLayeredHistoryMarker } from "@/components/stark/useLayeredHistoryMarker";
import { usePrimaryTabBackGuard } from "@/components/stark/usePrimaryTabBackGuard";
import { hasActiveLayerHistoryMarker } from "@/lib/stark/navigation/layered-history";
import { floatingJournal, isFloatingJournalAvailable, type FloatingJournalAction } from "@/lib/stark/floating-journal";

const KT_HYBRID_TAB_PATHS = new Set([
  "/app",
  "/app/consumption",
  "/app/savings",
  "/app/loans",
  "/app/assets",
  "/app/accounts",
]);

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [ktHybridShell, setKtHybridShell] = useState(false);
  const tabsPrefetchedRef = useRef(false);
  usePrimaryTabBackGuard(pathname);
  const isJournalRoute = pathname.startsWith("/app/journal");
  const isSavingsRoute = pathname.startsWith("/app/savings");
  const isAssetsRoute = pathname.startsWith("/app/assets");
  const isLoansRoute = pathname.startsWith("/app/loans");
  const [journalVariant, setJournalVariant] = useState<"journal" | "savings" | "asset" | "loan" | null>(null);
  const [floatingAction, setFloatingAction] = useState<FloatingJournalAction | null>(null);
  const handledFloatingActionsRef = useRef(new Set<string>());
  const journalOpenPathRef = useRef<string | null>(null);
  const dismissJournal = useCallback(() => {
    journalOpenPathRef.current = null;
    document.documentElement.removeAttribute("data-stark-journal-opening");
    setJournalVariant(null);
    setFloatingAction(null);
  }, []);
  const consumeJournalHistory = useLayeredHistoryMarker(Boolean(journalVariant), "starkJournal", dismissJournal);

  useEffect(() => () => {
    document.documentElement.removeAttribute("data-stark-journal-opening");
  }, []);

  useEffect(() => {
    const closePendingJournal = (event: Event) => {
      if (event.defaultPrevented || hasActiveLayerHistoryMarker()
        || !document.documentElement.hasAttribute("data-stark-journal-opening")) return;
      event.preventDefault();
      dismissJournal();
    };
    window.addEventListener("stark:android-back", closePendingJournal);
    return () => window.removeEventListener("stark:android-back", closePendingJournal);
  }, [dismissJournal]);

  useEffect(() => {
    if (journalOpenPathRef.current !== null && pathname !== journalOpenPathRef.current) dismissJournal();
  }, [dismissJournal, pathname]);

  useEffect(() => {
    if (!navigator.userAgent.includes("WottyStarkKtHybrid")) return;
    setKtHybridShell(true);
    document.documentElement.classList.add("kt-hybrid-shell");
    return () => document.documentElement.classList.remove("kt-hybrid-shell");
  }, []);

  useEffect(() => {
    if (!ktHybridShell) return;
    const handleNativeTab = (event: Event) => {
      const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
      if (typeof path !== "string" || !KT_HYBRID_TAB_PATHS.has(path)) return;
      router.replace(path, { scroll: false });
    };
    window.addEventListener("stark:kt-hybrid-tab", handleNativeTab);
    return () => window.removeEventListener("stark:kt-hybrid-tab", handleNativeTab);
  }, [ktHybridShell, router]);

  useEffect(() => {
    if (!ktHybridShell || tabsPrefetchedRef.current) return;
    const timer = window.setTimeout(() => {
      tabsPrefetchedRef.current = true;
      for (const path of KT_HYBRID_TAB_PATHS) router.prefetch(path);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [ktHybridShell, router]);

  const openJournal = useCallback(() => {
    setFloatingAction(null);
    journalOpenPathRef.current = pathname;
    document.documentElement.setAttribute("data-stark-journal-opening", "true");
    const variant = isLoansRoute ? "loan" : isAssetsRoute ? "asset" : isSavingsRoute ? "savings" : "journal";
    setJournalVariant(variant);
    void preloadJournalPanel().catch(dismissJournal);
  }, [dismissJournal, isAssetsRoute, isLoansRoute, isSavingsRoute, pathname]);

  const handleFloatingJournalAction = useCallback((action: Partial<FloatingJournalAction>) => {
    if (typeof action.actionId !== "string" || !action.actionId
      || (action.mode !== "screen" && action.mode !== "upload")
      || handledFloatingActionsRef.current.has(action.actionId)) return;
    handledFloatingActionsRef.current.add(action.actionId);
    if (handledFloatingActionsRef.current.size > 32) {
      const oldest = handledFloatingActionsRef.current.values().next().value;
      if (oldest) handledFloatingActionsRef.current.delete(oldest);
    }
    const request: FloatingJournalAction = {
      actionId: action.actionId,
      mode: action.mode,
      ...(typeof action.imageData === "string" ? { imageData: action.imageData } : {}),
      ...(typeof action.message === "string" ? { message: action.message } : {}),
    };
    setFloatingAction(request);
    journalOpenPathRef.current = pathname;
    document.documentElement.setAttribute("data-stark-journal-opening", "true");
    setJournalVariant("journal");
    void preloadJournalPanel().catch(dismissJournal);
    void floatingJournal().acknowledgeAction({ actionId: action.actionId }).catch(() => undefined);
  }, [dismissJournal, pathname]);

  useEffect(() => {
    if (!isFloatingJournalAvailable()) return;
    let active = true;
    let listener: { remove: () => Promise<void> } | null = null;
    void floatingJournal().addListener("journalAction", (action) => {
      if (active) handleFloatingJournalAction(action);
    }).then((registered) => {
      if (!active) void registered.remove();
      else listener = registered;
    }).catch(() => undefined);
    void floatingJournal().getPendingAction().then((action) => {
      if (active) handleFloatingJournalAction(action);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (listener) void listener.remove();
    };
  }, [handleFloatingJournalAction]);

  useEffect(() => {
    if (!ktHybridShell) return;
    window.addEventListener("stark:kt-hybrid-journal", openJournal);
    return () => window.removeEventListener("stark:kt-hybrid-journal", openJournal);
  }, [ktHybridShell, openJournal]);

  function closeJournal() {
    consumeJournalHistory();
    dismissJournal();
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        paddingTop: "env(safe-area-inset-top)",
        background: "var(--background)",
      }}
    >
      <main className="tabs-shell tabs-liquid-shell">{children}</main>
      {!isJournalRoute && !ktHybridShell ? (
        <MobileBottomNav onOpenJournal={openJournal} journalLabel={isLoansRoute ? "新增贷款" : isAssetsRoute ? "新增资产" : isSavingsRoute ? "添加储蓄" : "记账"} />
      ) : null}
      {journalVariant ? (
        <JournalPanel
          mode="page"
          variant={journalVariant}
          historyMode="route"
          floatingAction={floatingAction}
          onClose={closeJournal}
          onSaved={closeJournal}
        />
      ) : null}
    </div>
  );
}
