"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { EChartView } from "@/components/stark/EChartView";
import { formatMoney, isReportingYearKey, reportingMonthDate } from "@/lib/stark/utils/format";
import type { Transaction } from "@/lib/stark/models";
import { formatMonthLabel, useAppLocale } from "@/lib/stark/i18n";

type ShoppingMerchant = { name: string; count: number; amount: number };
type ShoppingKeyword = { name: string; count: number };

function collectShoppingTransactions(transactions: Transaction[]) {
  return transactions.filter((transaction) =>
    transaction.type === "EXPENSE"
    && transaction.category === "购物"
    && Number.isFinite(transaction.amount)
    && transaction.amount > 0,
  );
}

function buildShoppingTrend(transactions: Transaction[], period: string, locale: "zh-CN" | "en-US") {
  if (isReportingYearKey(period)) {
    const year = Number(period);
    const labels = Array.from({ length: 12 }, (_, index) =>
      formatMonthLabel(`${year}-${String(index + 1).padStart(2, "0")}`, locale),
    );
    const counts = Array.from({ length: 12 }, () => 0);
    for (const transaction of transactions) {
      if (!transaction.date.startsWith(`${period}-`)) continue;
      const month = Number(transaction.date.slice(5, 7));
      if (month >= 1 && month <= 12) counts[month - 1] += 1;
    }
    return { labels, counts };
  }

  const date = reportingMonthDate(period);
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const labels = Array.from({ length: daysInMonth }, (_, index) =>
    locale === "zh-CN" ? `${index + 1}日` : String(index + 1),
  );
  const counts = Array.from({ length: daysInMonth }, () => 0);
  for (const transaction of transactions) {
    if (!transaction.date.startsWith(`${yearMonth}-`)) continue;
    const day = Number(transaction.date.slice(8, 10));
    if (day >= 1 && day <= daysInMonth) counts[day - 1] += 1;
  }
  return { labels, counts };
}

function buildShoppingTrendOption(
  trend: ReturnType<typeof buildShoppingTrend>,
  isYear: boolean,
  locale: "zh-CN" | "en-US",
): EChartsCoreOption {
  const countLabel = locale === "zh-CN" ? "笔账单" : "bills";
  return {
    animationDuration: 350,
    grid: { left: 14, right: 10, top: 12, bottom: 22, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(19, 27, 48, 0.92)",
      borderWidth: 0,
      padding: [8, 10],
      textStyle: { color: "#ffffff", fontSize: 12 },
      valueFormatter: (value: number | string) => `${Number(value ?? 0)} ${countLabel}`,
    },
    xAxis: {
      type: "category",
      data: trend.labels,
      axisLine: { lineStyle: { color: "#e1e8f2" } },
      axisTick: { show: false },
      axisLabel: { color: "#74819a", fontSize: 10, interval: isYear ? 0 : "auto" },
    },
    yAxis: {
      type: "value",
      min: 0,
      minInterval: 1,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#74819a", fontSize: 10, formatter: (value: number) => String(Math.round(value)) },
      splitLine: { lineStyle: { color: "#eef2f7", type: "dashed" } },
    },
    series: [{
      name: locale === "zh-CN" ? "购物账单笔数" : "Shopping bills",
      type: "bar",
      data: trend.counts,
      barMaxWidth: isYear ? 20 : 12,
      itemStyle: { color: "#e87965", borderRadius: [5, 5, 0, 0] },
      emphasis: { itemStyle: { color: "#d85c4d" } },
    }],
  };
}

function buildMerchantRanking(transactions: Transaction[]): ShoppingMerchant[] {
  const merchants = new Map<string, ShoppingMerchant>();
  for (const transaction of transactions) {
    const name = transaction.merchant?.trim();
    if (!name) continue;
    const item = merchants.get(name);
    if (item) {
      item.count += 1;
      item.amount += transaction.amount;
    } else {
      merchants.set(name, { name, count: 1, amount: transaction.amount });
    }
  }
  return [...merchants.values()]
    .sort((a, b) => b.count - a.count || b.amount - a.amount || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 5);
}

function buildKeywordRanking(transactions: Transaction[]): ShoppingKeyword[] {
  const keywords = new Map<string, number>();
  for (const transaction of transactions) {
    const parts = (transaction.description ?? "")
      .split(/[、，,;；/|＋+\n\r]+/)
      .map((part) => part.trim().replace(/^[\s"'“”‘’()[\]{}<>【】《》:：]+|[\s"'“”‘’()[\]{}<>【】《》:：]+$/g, ""))
      .filter(Boolean);
    // Count at most one mention per bill so repeated text in one note does not
    // look like multiple purchased units.
    for (const keyword of new Set(parts)) keywords.set(keyword, (keywords.get(keyword) ?? 0) + 1);
  }
  return [...keywords.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 5);
}

function billCountLabel(count: number, locale: "zh-CN" | "en-US") {
  return locale === "zh-CN" ? `${count} 笔账单` : `${count} bills`;
}

export function ShoppingAnalysis({ transactions, period }: { transactions: Transaction[]; period: string }) {
  const locale = useAppLocale();
  const shoppingTransactions = useMemo(() => collectShoppingTransactions(transactions), [transactions]);
  const amountSummary = useMemo(() => {
    const amount = shoppingTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    const smallTransactions = shoppingTransactions.filter((transaction) => transaction.amount <= 50);
    return {
      amount,
      count: shoppingTransactions.length,
      average: shoppingTransactions.length ? amount / shoppingTransactions.length : 0,
      smallAmount: smallTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
      smallCount: smallTransactions.length,
    };
  }, [shoppingTransactions]);
  const trend = useMemo(() => buildShoppingTrend(shoppingTransactions, period, locale), [locale, period, shoppingTransactions]);
  const trendOption = useMemo(
    () => buildShoppingTrendOption(trend, isReportingYearKey(period), locale),
    [locale, period, trend],
  );
  const merchants = useMemo(() => buildMerchantRanking(shoppingTransactions), [shoppingTransactions]);
  const keywords = useMemo(() => buildKeywordRanking(shoppingTransactions), [shoppingTransactions]);
  const hasShoppingBills = shoppingTransactions.length > 0;

  return (
    <section className="home-card consumption-chart-card shopping-analysis-card">
      <div className="trend-panel">
        <div className="section-head">
          <div className="consumption-chart-title">
            <h2>{locale === "zh-CN" ? "购物分析" : "Shopping analysis"}</h2>
            <span>{locale === "zh-CN" ? "按当前周期、账户和搜索条件统计" : "Uses the selected period, account, and search filters"}</span>
          </div>
        </div>

        {!hasShoppingBills ? (
          <div className="shopping-analysis-empty">
            {locale === "zh-CN" ? "当前筛选下暂无购物账单" : "No shopping bills match the current filters"}
          </div>
        ) : (
          <>
            <div className="shopping-analysis-metrics">
              <div><span>{locale === "zh-CN" ? "购物总额" : "Total spending"}</span><strong>¥{formatMoney(amountSummary.amount)}</strong></div>
              <div><span>{locale === "zh-CN" ? "购物账单" : "Shopping bills"}</span><strong>{amountSummary.count}</strong></div>
              <div><span>{locale === "zh-CN" ? "单笔均额" : "Average bill"}</span><strong>¥{formatMoney(amountSummary.average)}</strong></div>
              <div className="shopping-analysis-small-spend">
                <span>{locale === "zh-CN" ? "≤ ¥50 小额累计" : "Bills ≤ ¥50"}</span>
                <strong>¥{formatMoney(amountSummary.smallAmount)}</strong>
                <small>{billCountLabel(amountSummary.smallCount, locale)}</small>
              </div>
            </div>

            <div className="shopping-analysis-trend-head">
              <strong>{locale === "zh-CN"
                ? isReportingYearKey(period) ? "每月购物账单笔数" : "每日购物账单笔数"
                : isReportingYearKey(period) ? "Shopping bills by month" : "Shopping bills by day"}</strong>
              <span>{locale === "zh-CN" ? "按账单统计，拆分记账会分别计数" : "Counted by bill; split entries count separately"}</span>
            </div>
            <EChartView
              option={trendOption}
              className="shopping-analysis-trend"
              ariaLabel={locale === "zh-CN" ? "购物账单笔数趋势图" : "Shopping bill count trend"}
            />

            <div className="shopping-analysis-rankings">
              <section>
                <div className="shopping-analysis-list-head">
                  <h3>{locale === "zh-CN" ? "高频商户" : "Frequent merchants"}</h3>
                  <span>{locale === "zh-CN" ? "按账单笔数" : "By bill count"}</span>
                </div>
                {merchants.length ? (
                  <ol>
                    {merchants.map((merchant, index) => (
                      <li key={merchant.name}>
                        <i>{index + 1}</i>
                        <span className="shopping-analysis-rank-name" title={merchant.name}>{merchant.name}</span>
                        <small>{billCountLabel(merchant.count, locale)}</small>
                        <strong>¥{formatMoney(merchant.amount)}</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="shopping-analysis-list-empty">{locale === "zh-CN" ? "还没有填写商户名称" : "No merchant names recorded"}</p>
                )}
              </section>

              <section>
                <div className="shopping-analysis-list-head">
                  <h3>{locale === "zh-CN" ? "备注关键词" : "Note keywords"}</h3>
                  <span>{locale === "zh-CN" ? "按提及账单数" : "Bills mentioning each term"}</span>
                </div>
                {keywords.length ? (
                  <ol>
                    {keywords.map((keyword, index) => (
                      <li key={keyword.name}>
                        <i>{index + 1}</i>
                        <span className="shopping-analysis-rank-name" title={keyword.name}>{keyword.name}</span>
                        <small>{locale === "zh-CN" ? "提及" : "mentions"}</small>
                        <strong>{keyword.count}</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="shopping-analysis-list-empty">{locale === "zh-CN" ? "还没有填写商品备注" : "No product notes recorded"}</p>
                )}
              </section>
            </div>

            <p className="shopping-analysis-footnote">
              {locale === "zh-CN"
                ? "把商品名称写在明细备注中，多个名称可用顿号或逗号分隔。关键词按账单提及次数统计，不代表购买件数或商品金额。"
                : "Add product names to transaction notes and separate multiple names with commas. Keyword counts show bills mentioning each term, not item quantities or product-level spending."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
