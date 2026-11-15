import type { LedgerWorkbook, WorkbookTable, WorkbookRow } from "../export/ledger-workbook";
import { WORKBOOK_TABLES } from "../export/ledger-workbook-format.ts";
import { sha256 } from "../utils/sha256.ts";
import { savingsFundEntries, preserveSavingsFund, moneyCents } from "../savings/funds.ts";
import { savingsPlanRecordedAmount } from "../savings/recorded-amount.ts";
import type { SavingsGoal, SavingsPlan } from "../models/types";

// IndexedDB does not enforce column types, unlike the SQL import paths.
const requiredFields: Record<WorkbookTable, Record<string, string>> = {
  accounts: { name: "string" },
  transactions: { amount: "number", type: "string", category: "string", platform: "string", date: "string" },
  assets: { name: "string", type: "string", balance: "number", currency: "string" },
  budgets: { amount: "number", category: "string", period: "string", alertPercent: "number", scopeType: "string" },
  loans: { platform: "string", totalAmount: "number", remainingAmount: "number", periods: "number", paidPeriods: "number", monthlyPayment: "number", dueDate: "number", status: "string" },
  savingsGoals: { name: "string", targetAmount: "number", currentAmount: "number", type: "string", status: "string", depositType: "string" },
  savingsPlans: { goalId: "string", amount: "number", status: "string", month: "string" },
  subscriptions: { name: "string", amount: "number", billingDay: "number", category: "string", platform: "string", startDate: "string", isActive: "boolean" },
  categoryRules: { merchant: "string", merchantKey: "string", category: "string", isActive: "boolean" },
  importErrorLogs: { fileName: "string", lineNumber: "number", rawData: "string", errorMessage: "string", errorType: "string", resolved: "boolean" },
  exchangeRates: { from: "string", to: "string", rate: "number" },
  themeConfigs: { themeId: "string", isDarkMode: "boolean" },
};
function validateLocalRow(table: WorkbookTable, row: WorkbookRow) {
  const fields = { ...requiredFields[table], updatedAt: "string", ...(table !== "exchangeRates" ? { createdAt: "string" } : {}) };
  if (table === "importErrorLogs") delete (fields as Record<string, string>).updatedAt;
  for (const [field, type] of Object.entries(fields)) {
    const value = row[field];
    if (typeof value !== type || (type === "number" && !Number.isFinite(value))) throw new Error(`${WORKBOOK_TABLES[table]}字段无效：${field}`);
  }
  for (const field of ["actualAmount", "salary", "openingBalance", "radius"]) {
    const value = row[field];
    if (value != null && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`${WORKBOOK_TABLES[table]}字段无效：${field}`);
  }
}

export function prepareLocalWorkbook(userId: string, input: LedgerWorkbook) {
  if (input.format !== "star-accounting-workbook" || input.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(input.importId)) throw new Error("账本工作簿格式无效");
  const hash = (value: string) => sha256(new TextEncoder().encode(value)).slice(0, 40);
  const accountId = `workbook-${hash(`${userId}\0${input.importId}`)}`;
  const sheets = structuredClone(input.sheets);
  const tables = Object.keys(WORKBOOK_TABLES) as WorkbookTable[];
  if (Object.keys(sheets).length !== tables.length || Object.keys(sheets).some((table) => !tables.includes(table as WorkbookTable)) || sheets.accounts?.length !== 1 || sheets.themeConfigs?.length > 1) throw new Error("工作表缺失或账本信息无效");
  const ids = new Map<WorkbookTable, Map<string, string>>();
  if (Object.values(sheets).reduce((sum, rows) => sum + rows.length, 0) > 500000) throw new Error("工作表记录数量超出上限");
  for (const table of tables) {
    if (!Array.isArray(sheets[table])) throw new Error("工作表缺失");
    const map = new Map<string, string>();
    for (const row of sheets[table]) {
      validateLocalRow(table, row);
      if (typeof row.id !== "string" || !row.id || row.id.length > 191 || map.has(row.id)) throw new Error("工作表 ID 缺失或重复");
      if (["__deleted", "password", "token"].some((key) => key in row)) throw new Error("工作表含不允许导入的字段");
      map.set(row.id, table === "accounts" ? accountId : `wb-${hash(`${accountId}\0${table}\0${row.id}`)}`);
    }
    ids.set(table, map);
  }
  const ref = (table: WorkbookTable, id: unknown): string => {
    const value = ids.get(table)?.get(String(id));
    if (!value) throw new Error(`关联记录不存在：${table}`);
    return value;
  };
  const originalAccount = sheets.accounts[0].id;
  const planGoals = new Map(sheets.savingsPlans.map((row) => [row.id, row.goalId]));
  for (const table of tables) for (const row of sheets[table]) {
    const oldId = row.id;
    row.id = ref(table, oldId);
    if (table === "accounts") { row.ownerId = userId; row.name = `${row.name}（导入）`; }
    else if (table === "savingsPlans") row.goalId = ref("savingsGoals", row.goalId);
    else if (table !== "exchangeRates") {
      if (table !== "themeConfigs" && row.accountId !== originalAccount) throw new Error("工作表记录不属于导出账本");
      row.userId = userId; row.accountId = accountId;
    }
    if (table === "transactions") {
      if (row.loanId) row.loanId = ref("loans", row.loanId);
      for (const [old, next] of ids.get("subscriptions")!) {
        if (String(oldId).startsWith(`subscription-${old}-`)) row.id = `subscription-${next}-${String(oldId).slice(`subscription-${old}-`.length)}`;
        if (String(row.orderId).startsWith(`subscription:${old}:`)) row.orderId = `subscription:${next}:${String(row.orderId).slice(`subscription:${old}:`.length)}`;
      }
    }
    if (table === "savingsGoals") {
      const entries = savingsFundEntries(row as unknown as SavingsGoal);
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error("储蓄资金操作 ID 重复");
      const remaining = new Map(entries.filter((entry) => entry.kind === "WITHDRAWAL").map((entry) => {
        const parts = new Map<string | null, number>();
        for (const part of entry.allocations) parts.set(part.planId ?? null, (parts.get(part.planId ?? null) ?? 0) + part.cents);
        return [entry.id, parts];
      }));
      for (const entry of entries) {
        if (entry.kind === "WITHDRAWAL" && entry.withdrawalId) throw new Error("取用记录不能关联另一笔取用。");
        if (entry.kind === "REPLENISHMENT") {
          const parts = remaining.get(entry.withdrawalId ?? "");
          if (!parts) throw new Error("储蓄补齐关联的取用不存在");
          for (const part of entry.allocations) {
            const left = (parts.get(part.planId ?? null) ?? 0) - part.cents;
            if (left < 0) throw new Error("储蓄补齐超过对应来源的取用金额");
            parts.set(part.planId ?? null, left);
          }
        }
        for (const part of entry.allocations) if (part.planId) {
          if (planGoals.get(part.planId) !== oldId) throw new Error("储蓄分配关联了其他目标的计划");
          part.planId = ref("savingsPlans", part.planId);
        }
      }
      row.fundMovements = JSON.stringify(entries);
    }
  }
  const plans = sheets.savingsPlans as unknown as SavingsPlan[];
  for (const goal of sheets.savingsGoals as unknown as SavingsGoal[]) {
    preserveSavingsFund(goal, goal, plans);
    const entries = savingsFundEntries(goal);
    for (const plan of plans.filter((item) => item.goalId === goal.id)) {
      const used = entries.reduce((sum, entry) => sum + (entry.kind === "WITHDRAWAL" ? 1 : -1) * entry.allocations.filter((part) => part.planId === plan.id).reduce((sum, part) => sum + part.cents, 0), 0);
      if (used > moneyCents(savingsPlanRecordedAmount(plan))) throw new Error("储蓄取用超过对应计划的存入金额");
    }
  }
  return { accountId, sheets };
}
