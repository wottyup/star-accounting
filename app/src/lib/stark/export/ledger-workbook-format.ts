export const WORKBOOK_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const WORKBOOK_FORMAT = "star-accounting-workbook";
export const WORKBOOK_TABLES = {
  accounts: "账本信息", transactions: "账单", assets: "资产", budgets: "预算", loans: "贷款",
  savingsGoals: "储蓄目标", savingsPlans: "储蓄计划", subscriptions: "周期扣费",
  categoryRules: "归类规则", importErrorLogs: "导入问题", exchangeRates: "汇率", themeConfigs: "主题配置",
} as const;
export type WorkbookTable = keyof typeof WORKBOOK_TABLES;
export type WorkbookRow = Record<string, unknown>;
export type LedgerWorkbook = {
  format: typeof WORKBOOK_FORMAT;
  schemaVersion: 1;
  importId: string;
  sheets: Record<WorkbookTable, WorkbookRow[]>;
};
export type WorkbookImportResult = { accountId: string; imported: number; reused: boolean };
