import assert from "node:assert/strict";
import test from "node:test";
import { buildHomeSummary } from "./summary.ts";

const timestamp = "2026-11-18 12:00:00";
function budget(id, amount = 1000, extra = {}) {
  return { id, userId: "local-user", accountId: "default", amount, category: "ALL", scopeType: "GLOBAL", period: "MONTHLY", platform: null, alertPercent: 80, createdAt: timestamp, updatedAt: timestamp, ...extra };
}
function transaction(id, date, amount, type = "EXPENSE") {
  return { id, userId: "local-user", accountId: "default", amount, type, category: type === "INCOME" ? "工资" : "餐饮", platform: "支付宝", date, createdAt: timestamp, updatedAt: timestamp };
}
const transactions = [
  transaction("previous-year", "2025-11-18 12:00:00", 10000),
  transaction("january", "2026-01-18 12:00:00", 800),
  transaction("november", timestamp, 200),
  transaction("income", timestamp, 3000, "INCOME"),
];
function summary(budgets, reportingMonth = "2026-11", items = transactions) {
  return buildHomeSummary({ transactions: items, assets: [], loans: [], savingsGoals: [], budgets, reportingMonth, referenceDate: new Date(2026, 10, 18, 12) });
}

test("missing, invalid and wrong-period budgets stay unset instead of fabricating a balance", () => {
  for (const budgets of [[], [budget("annual", 1000, { period: "YEARLY" })], [budget("zero", 0)], [budget("negative", -10)], [budget("invalid", NaN)], [budget("category", 1000, { scopeType: "CATEGORY", category: "餐饮" })]]) {
    assert.equal(summary(budgets).totalBudget, null);
  }
  assert.equal(summary([budget("monthly")], "2026").totalBudget, null);
});

test("monthly totals use monthly expenses even when a category or annual alert ranks first", () => {
  const result = summary([budget("monthly"), budget("annual", 500, { period: "YEARLY" }), budget("category", 10, { scopeType: "CATEGORY", category: "餐饮" })]);
  assert.notEqual(result.budgetAlerts[0].id, "monthly");
  assert.deepEqual(result.totalBudget, { id: "monthly", period: "MONTHLY", amount: 1000, spent: 200, remaining: 800, usedPercent: 20, remainingPercent: 80, state: "available" });
});

test("annual totals count the entire selected year and exclude income and other years", () => {
  const result = summary([budget("monthly"), budget("annual", 2000, { period: "YEARLY" })], "2026");
  assert.equal(result.totalBudget.id, "annual");
  assert.equal(result.totalBudget.spent, 1000);
  assert.equal(result.totalBudget.remaining, 1000);
  assert.equal(result.totalBudget.usedPercent, 50);
});

test("same-period totals select the most recently updated budget independently of array order", () => {
  const old = budget("old", 1000, { updatedAt: "2026-11-17 12:00:00" });
  const latest = budget("latest", 2000);
  assert.equal(summary([old, latest]).totalBudget.id, "latest");
  assert.equal(summary([latest, old]).totalBudget.id, "latest");
});

test("used-up and overspent totals remain distinct and retain negative remaining amounts", () => {
  const exhausted = summary([budget("monthly", 200)]).totalBudget;
  assert.equal(exhausted.state, "exhausted");
  assert.equal(exhausted.remaining, 0);
  const overspent = summary([budget("monthly", 100)]).totalBudget;
  assert.equal(overspent.state, "overspent");
  assert.equal(overspent.remaining, -100);
  assert.equal(overspent.usedPercent, 200);
  assert.equal(overspent.remainingPercent, -100);
});

test("money is compared in cents so normal decimal spending does not create false overspending", () => {
  const result = summary([budget("monthly", 0.3)], "2026-11", [transaction("a", timestamp, 0.1), transaction("b", timestamp, 0.2)]);
  assert.equal(result.totalBudget.remaining, 0);
  assert.equal(result.totalBudget.state, "exhausted");
});

test("budget updates and removal recompute totals, while cashflow can remain negative independently", () => {
  assert.equal(summary([budget("monthly", 1000)]).totalBudget.remaining, 800);
  assert.equal(summary([budget("monthly", 500)]).totalBudget.remaining, 300);
  assert.equal(summary([]).totalBudget, null);
  const result = summary([budget("monthly", 1000)], "2026-11", [transaction("expense-only", timestamp, 200)]);
  assert.equal(result.totalBudget.state, "available");
  assert.equal(result.forecast.monthBalance, -200);
});
