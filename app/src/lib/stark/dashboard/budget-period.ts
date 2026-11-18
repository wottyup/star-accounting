import type { Budget, Transaction } from "../models/types";

export interface HomeTotalBudget {
  id: string;
  period: Budget["period"];
  amount: number;
  spent: number;
  remaining: number;
  usedPercent: number;
  remainingPercent: number;
  state: "available" | "exhausted" | "overspent";
}

/** A manual total for the selected calendar period, independent of risk-sorted alerts. */
export function summarizeHomeTotalBudget(
  budgets: readonly Budget[],
  reportingPeriod: string,
  periodExpense: number,
): HomeTotalBudget | null {
  const period = isYearKey(reportingPeriod) ? "YEARLY" : "MONTHLY";
  const budget = budgets
    .filter((item) => item.scopeType === "GLOBAL" && item.period === period
      && Number.isFinite(item.amount) && Math.round(item.amount * 100) > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)
      || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))[0];
  if (!budget) return null;

  const amountCents = Math.round(budget.amount * 100);
  const spentCents = Math.round(periodExpense * 100);
  const remainingCents = amountCents - spentCents;
  return {
    id: budget.id,
    period,
    amount: amountCents / 100,
    spent: spentCents / 100,
    remaining: remainingCents / 100,
    usedPercent: spentCents / amountCents * 100,
    remainingPercent: remainingCents / amountCents * 100,
    state: remainingCents < 0 ? "overspent" : remainingCents === 0 ? "exhausted" : "available",
  };
}

function isYearKey(value: string) {
  return /^\d{4}$/.test(value);
}

function normalizeCategory(category: string) {
  if (category.includes("生活")) return "生活消费";
  if (category.includes("交") || category.includes("车")) return "交通出行";
  if (category.includes("餐") || category.includes("饮")) return "餐饮美食";
  if (category.includes("娱")) return "休闲娱乐";
  if (category.includes("购")) return "购物消费";
  if (category.includes("工")) return "工资收入";
  return category || "其他";
}

export function calculateBudgetSpent(
  transactions: readonly Transaction[],
  budget: Pick<Budget, "period" | "scopeType" | "category" | "platform">,
  reportingMonth: string,
  monthlyExpense = 0,
) {
  const year = isYearKey(reportingMonth) ? reportingMonth : reportingMonth.slice(0, 4);
  const periodTransactions = budget.period === "YEARLY"
    ? transactions.filter((item) => item.type === "EXPENSE" && item.date.slice(0, 4) === year)
    : transactions.filter((item) => item.type === "EXPENSE" && (isYearKey(reportingMonth) ? item.date.slice(0, 4) === reportingMonth : item.date.slice(0, 7) === reportingMonth));

  if (budget.scopeType === "GLOBAL") {
    return budget.period === "YEARLY"
      ? periodTransactions.reduce((sum, item) => sum + item.amount, 0)
      : monthlyExpense;
  }
  if (budget.scopeType === "PLATFORM") {
    return periodTransactions.filter((item) => item.platform === budget.platform).reduce((sum, item) => sum + item.amount, 0);
  }
  return periodTransactions
    .filter((item) => normalizeCategory(item.category) === normalizeCategory(budget.category))
    .reduce((sum, item) => sum + item.amount, 0);
}
