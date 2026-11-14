"use client";

import { useCallback, useEffect, useId, useRef, useState, type PropsWithChildren } from "react";
import { translateValue, useAppLocale } from "@/lib/stark/i18n";
import { createPortal } from "react-dom";
import { useLayeredHistoryMarker } from "@/components/stark/useLayeredHistoryMarker";
import { useSheetPresentation } from "@/components/stark/useSheetPresentation";

const CLOSE_SETTLE_MS = 240;

type BottomSheetProps = PropsWithChildren<{
  title: string;
  onClose: () => void;
  historyMode?: "marker" | "route";
  closeRequest?: number;
  className?: string;
  overlayClassName?: string;
  bodyClassName?: string;
}>;

export function BottomSheet({ children, title, onClose, historyMode = "marker", closeRequest, className = "", overlayClassName = "", bodyClassName = "" }: BottomSheetProps) {
  const locale = useAppLocale();
  const displayTitle = translateValue(title, locale);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const layerReady = useSheetPresentation(mounted);
  const [enterReady, setEnterReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const handledCloseRequestRef = useRef(closeRequest);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (layerReady && !closingRef.current) setEnterReady(true);
  }, [layerReady]);

  const beginClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);

    // A browser or Android edge-back gesture can dispatch its final pointer
    // event after `popstate`. Keep the modal shield mounted through the close
    // animation so that event cannot click a bottom-nav item underneath.
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, CLOSE_SETTLE_MS);
  }, []);

  const consumeHistoryEntry = useLayeredHistoryMarker(
    mounted && historyMode === "marker",
    "starkBottomSheet",
    beginClose,
  );

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    beginClose();
    consumeHistoryEntry();
  }, [beginClose, consumeHistoryEntry]);

  useEffect(() => {
    if (closeRequest === undefined || closeRequest === handledCloseRequestRef.current) return;
    handledCloseRequestRef.current = closeRequest;
    requestClose();
  }, [closeRequest, requestClose]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    const original = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
    };

    body.style.position = "fixed";
    body.style.top = "-" + scrollY + "px";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";

    return () => {
      body.style.position = original.bodyPosition;
      body.style.top = original.bodyTop;
      body.style.width = original.bodyWidth;
      body.style.overflow = original.bodyOverflow;
      body.style.overscrollBehavior = original.bodyOverscrollBehavior;
      html.style.overflow = original.htmlOverflow;
      html.style.overscrollBehavior = original.htmlOverscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [requestClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`bottom-sheet-overlay ${enterReady ? "is-ready" : ""} ${closing ? "is-closing" : ""} ${overlayClassName}`.trim()}
      onClick={(event) => {
        event.stopPropagation();
        requestClose();
      }}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <section className={`bottom-sheet ${enterReady ? "is-ready" : ""} ${closing ? "is-closing" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <div className="bottom-sheet-handle" aria-hidden="true" />
        <header className="bottom-sheet-header">
          <span aria-hidden="true" />
          <strong id={titleId}>{displayTitle}</strong>
          <button type="button" aria-label={locale === "en-US" ? `Close ${displayTitle}` : `关闭${displayTitle}`} onClick={requestClose}>×</button>
        </header>
        <div className={`bottom-sheet-body ${bodyClassName}`.trim()}>{children}</div>
      </section>
    </div>
    , document.body,
  );
}
