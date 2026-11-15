import assert from "node:assert/strict";
import test from "node:test";
import { buildHomeSummary } from "./summary.ts";
import { appendSavingsFundEntry } from "../savings/funds.ts";
import { summarizeSavingsProgress } from "../savings/progress.ts";

const timestamp = "2026-11-25 12:00:00";
const referenceDate = new Date(2026, 10, 25, 12);
const plans = [
  { id: "september", goalId: "annual", amount: 2000, actualAmount: 2000, actualDate: "2026-09-15 12:00:00", month: "2026-09", status: "COMPLETED", createdAt: timestamp, updatedAt: timestamp },
  { id: "october", goalId: "annual", amount: 1500, actualAmount: 1500, actualDate: "2026-10-15 12:00:00", month: "2026-10", status: "COMPLETED", createdAt: timestamp, updatedAt: timestamp },
];
const goal = { id: "annual", accountId: "ledger", userId: "test-user", name: "年度储蓄", currentAmount: 3500, targetAmount: 11500, type: "YEARLY", depositType: "CASH", status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp };
const salary = { id: "salary", accountId: "ledger", userId: "test-user", amount: 1000, type: "INCOME", category: "工资", platform: "银行卡", date: "2026-11-15 09:00:00", createdAt: timestamp, updatedAt: timestamp };
const spending = { ...salary, id: "spending", amount: 500, type: "EXPENSE", category: "购物", date: "2026-11-20 12:00:00" };
function withdraw(current = goal, date = "2026-11-11T23:39") {
  return appendSavingsFundEntry(current, plans, { id: "withdrawal", kind: "WITHDRAWAL", amountCents: 50000, date, note: "借款", withdrawalId: null }, timestamp);
}
function replenish(current, id, amountCents) {
  return appendSavingsFundEntry(current, plans, { id, kind: "REPLENISHMENT", amountCents, date: "2026-11-22T12:00", note: "补齐", withdrawalId: "withdrawal" }, timestamp);
}
function summary(current, transactions = [salary, spending], extra = {}) {
  return buildHomeSummary({ transactions, assets: [], loans: [], budgets: [], savingsGoals: [current], savingsPlans: plans, reportingMonth: "2026-11", salaryDay: 15, referenceDate, account: { openingBalance: 100, openingBalanceDate: "2026-11-01" }, ...extra });
}

test("3500 minus a 500 withdrawal agrees across home assets, allocation and savings overview", () => {
  const current = withdraw();
  const result = summary(current);
  assert.equal(current.currentAmount, 3500, "the original deposit remains intact");
  assert.equal(summarizeSavingsProgress([current], plans).savedAmount, 3000);
  assert.equal(result.totalSavings, 3000);
  assert.equal(result.assetTotal, 3000);
  assert.equal(result.budgetAllocation.assetTotal, 3000);
  assert.equal(result.netWorth, 3000);
  assert.equal(result.savingsOutstanding, 500);
});

test("previous-cycle withdrawal stays visible as outstanding without entering the next cycle", () => {
  const result = summary(withdraw());
  assert.equal(result.forecast.monthSavingsWithdrawal, 500);
  assert.equal(result.forecast.cycleSavingsWithdrawal, 0);
  assert.equal(result.savingsOutstanding, 500);
  assert.equal(result.forecast.salaryCarryover, 600);
  assert.equal(result.forecast.currentBalance, 1100);
  assert.equal(result.budgetAllocation.available, 500);
});

test("recording spending consumes cash once and does not subtract the same savings twice", () => {
  const current = withdraw();
  const beforeSpending = summary(current, [salary]);
  const afterSpending = summary(current);
  assert.equal(beforeSpending.forecast.currentBalance - afterSpending.forecast.currentBalance, 500);
  assert.equal(afterSpending.totalSavings, beforeSpending.totalSavings);
  assert.equal(afterSpending.assetTotal, 3000);
  assert.equal(afterSpending.forecast.cycleIncome, 1000, "withdrawal must not become income");
});

test("partial and full replenishments restore asset balances and deduct available cash", () => {
  let current = withdraw();
  current = replenish(current, "partial", 20000);
  const partial = summary(current);
  assert.equal(partial.assetTotal, 3200);
  assert.equal(partial.budgetAllocation.assetTotal, 3200);
  assert.equal(partial.netWorth, 3200);
  assert.equal(partial.savingsOutstanding, 300);
  assert.equal(partial.forecast.currentBalance, 900);
  assert.equal(partial.budgetAllocation.savings, 200);
  current = replenish(current, "rest", 30000);
  const full = summary(current);
  assert.equal(full.assetTotal, 3500);
  assert.equal(full.savingsOutstanding, 0);
  assert.equal(full.forecast.currentBalance, 600);
});

test("withdrawal within the selected cycle changes cashflow once", () => {
  const result = summary(withdraw(goal, "2026-11-20T10:00"));
  assert.equal(result.forecast.cycleSavingsWithdrawal, 500);
  assert.equal(result.budgetAllocation.savings, -500);
  assert.equal(result.budgetAllocation.available, 1000);
  assert.equal(result.forecast.currentBalance, 1100);
  assert.equal(result.assetTotal, 3000);
});

test("stale stored deposit totals use completed plans, and manual assets are added once", () => {
  const result = summary(withdraw({ ...goal, currentAmount: 0 }), [salary, spending], {
    assets: [{ id: "cash", balance: 80 }], loans: [{ id: "loan", remainingAmount: 20, totalAmount: 100, monthlyPayment: 10, dueDate: 20, status: "ACTIVE" }],
  });
  assert.equal(result.totalSavings, 3000);
  assert.equal(result.assetTotal, 3080);
  assert.equal(result.netWorth, 3060);
  assert.equal(result.budgetAllocation.assetTotal, 3080);
});
