"use client";

import { translateValue, useAppLocale } from "@/lib/stark/i18n";

export function FinancialPlanningNotice() {
  const locale = useAppLocale();
  return (
    <details className="financial-planning-notice">
      <summary><strong>{translateValue("规划提醒", locale)}</strong></summary>
      <p>{translateValue("本项目只用于规划，不能实际存入资金，请合理规划资金存放。", locale)}</p>
    </details>
  );
}
