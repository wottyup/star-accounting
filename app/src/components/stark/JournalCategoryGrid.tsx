"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { TransactionType } from "@/lib/stark/models";
import { translateText, type AppLocale } from "@/lib/stark/i18n";
import { categoryIconSrcForCategory } from "@/lib/stark/utils/category-icon";
import { groupJournalCategories } from "@/lib/stark/utils/category-groups";

export function JournalCategoryGrid({ categories, category, type, locale, onChange, autoFocus = false }: {
  categories: string[];
  category: string;
  type: TransactionType;
  locale: AppLocale;
  onChange: (category: string) => void;
  autoFocus?: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const swipeRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    axis: "pending" | "horizontal" | "vertical";
  } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const pickerId = useId();
  const groups = useMemo(() => groupJournalCategories(categories, type), [categories, type]);
  const selectedGroup = groups.find((group) => group.categories.includes(category)) ?? groups[0];
  const selectionKey = `${type}:${category}`;
  const [navigation, setNavigation] = useState({ selectionKey, groupId: selectedGroup?.id });

  // A restored draft or recognition response selects its own group. Browsing
  // another group alone never changes the category stored on the transaction.
  if (navigation.selectionKey !== selectionKey) {
    setNavigation({ selectionKey, groupId: selectedGroup?.id });
  }
  const activeGroup = (navigation.selectionKey === selectionKey
    ? groups.find((group) => group.id === navigation.groupId)
    : selectedGroup) ?? selectedGroup;

  useEffect(() => {
    const tabs = tabsRef.current;
    const activeTab = tabs?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (tabs && activeTab) {
      const container = tabs.getBoundingClientRect();
      const tab = activeTab.getBoundingClientRect();
      if (tab.left < container.left) tabs.scrollLeft += tab.left - container.left;
      else if (tab.right > container.right) tabs.scrollLeft += tab.right - container.right;
    }

    const grid = gridRef.current;
    const selected = grid?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!grid || !selected) return;
    const container = grid.getBoundingClientRect();
    const tile = selected.getBoundingClientRect();
    if (tile.top < container.top) grid.scrollTop += tile.top - container.top;
    else if (tile.bottom > container.bottom) grid.scrollTop += tile.bottom - container.bottom;
    if (autoFocus && !focusedRef.current) {
      selected.focus({ preventScroll: true });
      focusedRef.current = true;
    }
  }, [activeGroup?.id, category, autoFocus]);

  if (!activeGroup) return null;

  return (
    <div
      className="journal-category-picker"
      onPointerDownCapture={() => { suppressClickUntilRef.current = 0; }}
      onClickCapture={(event) => {
        if (event.detail > 0 && performance.now() < suppressClickUntilRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickUntilRef.current = 0;
        }
      }}
    >
      <div
        ref={tabsRef}
        className="journal-category-tabs"
        role="tablist"
        aria-label={translateText("分类大类", locale)}
        onKeyDown={(event) => {
          const current = groups.findIndex((group) => group.id === activeGroup.id);
          const next = event.key === "ArrowRight" ? (current + 1) % groups.length
            : event.key === "ArrowLeft" ? (current - 1 + groups.length) % groups.length
              : event.key === "Home" ? 0 : event.key === "End" ? groups.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          setNavigation({ selectionKey, groupId: groups[next].id });
          tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true });
        }}
      >
        {groups.map((group) => (
          <button
            key={group.id}
            id={`${pickerId}-tab-${group.id}`}
            type="button"
            role="tab"
            aria-selected={activeGroup.id === group.id}
            aria-controls={`${pickerId}-categories`}
            tabIndex={activeGroup.id === group.id ? 0 : -1}
            onClick={() => setNavigation({ selectionKey, groupId: group.id })}
          >{translateText(group.label, locale)}</button>
        ))}
      </div>
      <div
        key={activeGroup.id}
        ref={gridRef}
        id={`${pickerId}-categories`}
        className="modern-category-matrix"
        role="tabpanel"
        aria-labelledby={`${pickerId}-tab-${activeGroup.id}`}
        onPointerDown={(event) => {
          swipeRef.current = event.isPrimary && event.button === 0
            ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, axis: "pending" }
            : null;
        }}
        onPointerMove={(event) => {
          const swipe = swipeRef.current;
          if (!swipe || swipe.pointerId !== event.pointerId) return;
          const dx = Math.abs(event.clientX - swipe.x);
          const dy = Math.abs(event.clientY - swipe.y);
          if (swipe.axis === "pending" && Math.max(dx, dy) >= 12) {
            if (dx > dy * 1.3) swipe.axis = "horizontal";
            else if (dy > dx * 1.3) swipe.axis = "vertical";
          }
          if (swipe.axis === "horizontal") {
            suppressClickUntilRef.current = performance.now() + 500;
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }
        }}
        onPointerUp={(event) => {
          const swipe = swipeRef.current;
          swipeRef.current = null;
          if (!swipe || swipe.pointerId !== event.pointerId || swipe.axis !== "horizontal") return;
          const dx = event.clientX - swipe.x;
          const dy = event.clientY - swipe.y;
          if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
          suppressClickUntilRef.current = performance.now() + 500;
          const current = groups.findIndex((group) => group.id === activeGroup.id);
          const next = Math.max(0, Math.min(groups.length - 1, current + (dx < 0 ? 1 : -1)));
          if (next !== current) setNavigation({ selectionKey, groupId: groups[next].id });
        }}
        onPointerCancel={() => { swipeRef.current = null; }}
        onLostPointerCapture={(event) => {
          // Touch starts with implicit capture on a tile. Moving that capture
          // to the grid must not cancel the horizontal gesture in progress.
          if (event.target === event.currentTarget) swipeRef.current = null;
        }}
      >
        {activeGroup.categories.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={`category-tile ${category === item ? "active" : ""}`}
            aria-pressed={category === item}
            title={translateText(item, locale)}
          >
            <span className="tile-icon-box">
              <img src={categoryIconSrcForCategory(item, type)} alt="" className="tile-icon" draggable={false} />
            </span>
            <span className="tile-label">{translateText(item, locale)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
