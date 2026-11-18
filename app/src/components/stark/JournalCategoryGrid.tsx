"use client";

import { useEffect, useRef } from "react";
import type { TransactionType } from "@/lib/stark/models";
import { translateText, type AppLocale } from "@/lib/stark/i18n";
import { categoryIconSrcForCategory } from "@/lib/stark/utils/category-icon";

export function JournalCategoryGrid({ categories, category, type, locale, onChange, autoFocus = false }: {
  categories: string[];
  category: string;
  type: TransactionType;
  locale: AppLocale;
  onChange: (category: string) => void;
  autoFocus?: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const selected = gridRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [autoFocus]);

  return (
    <div ref={gridRef} className="modern-category-matrix" aria-label={translateText("消费类型", locale)}>
      {categories.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`category-tile ${category === item ? "active" : ""}`}
          aria-pressed={category === item}
          title={translateText(item, locale)}
        >
          <span className="tile-icon-box">
            <img src={categoryIconSrcForCategory(item, type)} alt="" className="tile-icon" />
          </span>
          <span className="tile-label">{translateText(item, locale)}</span>
        </button>
      ))}
    </div>
  );
}
