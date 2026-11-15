import type {
  Account,
  Asset,
  Budget,
  CategoryRule,
  ExchangeRate,
  ImportErrorLog,
  Loan,
  SavingsGoal,
  SavingsPlan,
  Subscription,
  ThemeConfig,
  Transaction,
} from "@/lib/stark/models/types";
import { savingsFundEntries } from "@/lib/stark/savings/funds";

export type AccountArchiveData = {
  transactions: Transaction[];
  assets: Asset[];
  budgets: Budget[];
  loans: Loan[];
  savingsGoals: SavingsGoal[];
  savingsPlans: SavingsPlan[];
  subscriptions: Subscription[];
  categoryRules: CategoryRule[];
  importErrorLogs: ImportErrorLog[];
  exchangeRates: ExchangeRate[];
  themeConfig: ThemeConfig | null;
};

export function serializeAccountArchiveToJson(account: Account, data: AccountArchiveData) {
  const counts = {
    accounts: 1,
    transactions: data.transactions.length,
    assets: data.assets.length,
    budgets: data.budgets.length,
    loans: data.loans.length,
    savingsGoals: data.savingsGoals.length,
    savingsPlans: data.savingsPlans.length,
    savingsFundMovements: data.savingsGoals.reduce((sum, goal) => sum + savingsFundEntries(goal).length, 0),
    subscriptions: data.subscriptions.length,
    categoryRules: data.categoryRules.length,
    importErrorLogs: data.importErrorLogs.length,
    exchangeRates: data.exchangeRates.length,
    themeConfigs: data.themeConfig ? 1 : 0,
  };
  const archive = {
    format: "star-accounting-ledger-archive",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    recordCounts: counts,
    account,
    data,
  };
  return {
    content: `${JSON.stringify(archive, null, 2)}\n`,
    recordCounts: counts,
    totalRecordCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}
