import { savingsPlanActualDate } from "@/lib/stark/dashboard/salary-cycle";
import { savingsFundEntries } from "@/lib/stark/savings/funds";
import { savingsPlanRecordedAmount } from "@/lib/stark/savings/recorded-amount";
import type { SavingsGoal, SavingsPlan, Transaction } from "@/lib/stark/models/types";

export const TRANSACTION_EXPORT_HEADERS = [
  "流水ID",
  "日期",
  "类型",
  "分类",
  "备注归类",
  "商户",
  "平台",
  "购物平台",
  "金额",
  "支付方式",
  "状态",
  "订单号",
  "说明",
  "贷款ID",
  "储蓄目标ID",
  "储蓄目标",
  "储蓄计划ID",
  "储蓄操作ID",
  "关联取用ID",
  "资金分配明细(JSON,元)",
] as const;

const transactionTypeLabels: Record<Transaction["type"], string> = {
  INCOME: "收入",
  EXPENSE: "支出",
  TRANSFER: "转账",
  REPAYMENT: "还款",
};

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function transactionExportRows(transactions: Transaction[]) {
  return transactions.map((transaction) => [
    transaction.id,
    transaction.date,
    transactionTypeLabels[transaction.type] ?? transaction.type,
    transaction.category,
    transaction.remarkCategory,
    transaction.merchant,
    transaction.platform,
    transaction.shoppingPlatform,
    transaction.amount,
    transaction.paymentMethod,
    transaction.status,
    transaction.orderId,
    transaction.description,
    transaction.loanId,
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
}

export function savingsExportRows(goals: SavingsGoal[], plans: SavingsPlan[]) {
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const deposits = plans.flatMap((plan) => {
    const amount = savingsPlanRecordedAmount(plan);
    const date = savingsPlanActualDate(plan);
    if (!(amount > 0) || !date) return [];
    const goal = goalById.get(plan.goalId);
    return [[
      `savings-deposit:${plan.id}`,
      date,
      "储蓄存入",
      "储蓄",
      "",
      "",
      "",
      "",
      amount,
      "",
      "已存入",
      "",
      plan.remark,
      "",
      plan.goalId,
      goal?.name,
      plan.id,
      "",
      "",
      "",
    ]];
  });
  const fundMovements = goals.flatMap((goal) => savingsFundEntries(goal).map((entry) => {
    const isWithdrawal = entry.kind === "WITHDRAWAL";
    return [
      `savings-fund:${entry.id}`,
      entry.date,
      isWithdrawal ? "储蓄取用" : "储蓄补齐",
      "储蓄",
      "",
      "",
      "",
      "",
      entry.amountCents / 100,
      "",
      isWithdrawal ? "已取用" : "已补齐",
      "",
      entry.note,
      "",
      goal.id,
      goal.name,
      "",
      entry.id,
      entry.withdrawalId,
      JSON.stringify(entry.allocations.map(({ planId, month, cents }) => ({ planId, month, amount: cents / 100 }))),
    ];
  }));
  return [...deposits, ...fundMovements];
}

/** Serialize transactions and completed savings cash movements into one CSV. */
export function serializeAccountRecordsToCsv(
  transactions: Transaction[],
  goals: SavingsGoal[] = [],
  plans: SavingsPlan[] = [],
) {
  const rows = [...transactionExportRows(transactions), ...savingsExportRows(goals, plans)];
  rows.sort((left, right) => String(right[1] ?? "").localeCompare(String(left[1] ?? "")));
  const csvRows = [TRANSACTION_EXPORT_HEADERS, ...rows];
  const csv = csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return { csv, recordCount: rows.length, savingsRecordCount: rows.length - transactions.length };
}

/** Serialize transactions alone for callers that need the legacy bill-only CSV. */
export function serializeTransactionsToCsv(transactions: Transaction[]) {
  const rows = [TRANSACTION_EXPORT_HEADERS, ...transactionExportRows(transactions)];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
