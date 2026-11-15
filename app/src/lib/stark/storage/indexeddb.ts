import type {
  Account,
  Asset,
  Budget,
  CategoryRule,
  ExchangeRate,
  ImportErrorLog,
  ImportResult,
  Loan,
  LoanRepaymentClassificationResult,
  SavingsGoal,
  SavingsDepositInput,
  SavingsFundInput,
  SavingsPlan,
  Subscription,
  ThemeConfig,
  Transaction,
  User,
} from "@/lib/stark/models/types";
import { recordSavingsPlanDeposit } from "../savings/planner.ts";
import { appendSavingsFundEntry, assertSavingsPlanFundChange, preserveSavingsFund, savingsFundOutstanding } from "../savings/funds.ts";
const SHOWCASE_DEMO_MODE = process.env.NEXT_PUBLIC_SHOWCASE_DEMO === "1";

export function showcaseDatabaseName(basePath: string) {
  const scope = basePath.replace(/[^a-z0-9-]/gi, "-").replace(/^-+|-+$/g, "");
  return `wotty-stark-showcase-web${scope ? `-${scope}` : ""}`;
}

export const DB_NAME = SHOWCASE_DEMO_MODE ? showcaseDatabaseName(process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "") : "wotty-stark-web";
export const DB_VERSION = 2;

export type StoreName =
  | "users"
  | "accounts"
  | "transactions"
  | "assets"
  | "budgets"
  | "loans"
  | "savingsGoals"
  | "savingsPlans"
  | "categoryRules"
  | "importErrorLogs"
  | "exchangeRates"
  | "themeConfigs"
  | "subscriptions";

export interface StarkDbSchema {
  users: User;
  accounts: Account;
  transactions: Transaction;
  assets: Asset;
  budgets: Budget;
  loans: Loan;
  savingsGoals: SavingsGoal;
  savingsPlans: SavingsPlan;
  categoryRules: CategoryRule;
  importErrorLogs: ImportErrorLog;
  exchangeRates: ExchangeRate;
  themeConfigs: ThemeConfig;
  subscriptions: Subscription;
}

const STORE_NAMES: StoreName[] = [
  "users",
  "accounts",
  "transactions",
  "assets",
  "budgets",
  "loans",
  "savingsGoals",
  "savingsPlans",
  "categoryRules",
  "importErrorLogs",
  "exchangeRates",
  "themeConfigs",
  "subscriptions",
];

let dbPromise: Promise<IDBDatabase> | null = null;

function createStore(db: IDBDatabase, name: StoreName) {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, { keyPath: "id" });
  }
}

export function openDb() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser.");
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        STORE_NAMES.forEach((name) => createStore(db, name));
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
    });
  }

  return dbPromise;
}

async function withStore<T>(storeName: StoreName, mode: IDBTransactionMode, action: (store: IDBObjectStore) => void | Promise<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);

    Promise.resolve(action(store))
      .then((result) => {
        transaction.oncomplete = () => resolve(result as T);
        transaction.onerror = () => reject(transaction.error ?? new Error(`IndexedDB transaction failed: ${storeName}`));
        transaction.onabort = () => reject(transaction.error ?? new Error(`IndexedDB transaction aborted: ${storeName}`));
      })
      .catch(reject);
  });
}

export async function getAllRecords<T>(storeName: StoreName) {
  return withStore<T[]>(storeName, "readonly", (store) =>
    new Promise<T[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result ?? []) as T[]);
      request.onerror = () => reject(request.error ?? new Error(`Failed to getAll from ${storeName}`));
    }),
  );
}

export async function getRecord<T>(storeName: StoreName, id: string) {
  return withStore<T | undefined>(storeName, "readonly", (store) =>
    new Promise<T | undefined>((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error(`Failed to get record from ${storeName}`));
    }),
  );
}

export async function putRecord<T extends { id: string }>(storeName: StoreName, value: T) {
  return withStore<void>(storeName, "readwrite", (store) => {
    store.put(value);
  });
}

export async function putManyRecords<T extends { id: string }>(storeName: StoreName, values: T[]) {
  return withStore<void>(storeName, "readwrite", (store) => {
    values.forEach((value) => store.put(value));
  });
}

export async function deleteRecord(storeName: StoreName, id: string) {
  return withStore<void>(storeName, "readwrite", (store) => {
    store.delete(id);
  });
}

async function withSavingsState<T>(goalId: string, action: (goal: SavingsGoal | undefined, plans: SavingsPlan[], goals: IDBObjectStore, planStore: IDBObjectStore) => T) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(["savingsGoals", "savingsPlans"], "readwrite");
    const goals = tx.objectStore("savingsGoals");
    const plans = tx.objectStore("savingsPlans");
    const goalRequest = goals.get(goalId);
    const planRequest = plans.getAll();
    let loaded = 0;
    let result: T;
    let failure: unknown;
    const apply = () => {
      if (++loaded !== 2) return;
      try { result = action(goalRequest.result, planRequest.result as SavingsPlan[], goals, plans); }
      catch (error) { failure = error; tx.abort(); }
    };
    goalRequest.onsuccess = apply;
    planRequest.onsuccess = apply;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error("储蓄保存失败"));
  });
}

export async function saveSavingsGoalRecord(goal: SavingsGoal) {
  return withSavingsState(goal.id, (existing, plans, goals) => { goals.put(preserveSavingsFund(goal, existing, plans)); });
}

export async function saveSavingsPlanRecord(plan: SavingsPlan) {
  return withSavingsState(plan.goalId, (goal, plans, _goals, store) => {
    const old = plans.find((item) => item.id === plan.id);
    if (old && old.goalId !== plan.goalId) throw new Error("不能移动已有储蓄计划，请在原目标中修改。");
    if (!goal) throw new Error("储蓄目标不存在。");
    assertSavingsPlanFundChange(goal, old, plan);
    preserveSavingsFund(goal, goal, [...plans.filter((item) => item.id !== plan.id), plan]);
    store.put(plan);
  });
}

export async function deleteSavingsPlanRecord(plan: SavingsPlan) {
  return withSavingsState(plan.goalId, (goal, plans, _goals, store) => {
    assertSavingsPlanFundChange(goal, plans.find((item) => item.id === plan.id));
    store.delete(plan.id);
  });
}

export async function recordSavingsFundMovement(goalId: string, input: SavingsFundInput, accountId: string, now: string) {
  return withSavingsState(goalId, (goal, plans, goals) => {
    if (!goal || goal.accountId !== accountId) throw new Error("储蓄目标不存在或不属于当前账本。");
    const next = appendSavingsFundEntry(goal, plans, input, now);
    goals.put(next);
    return next;
  });
}

/** 在同一 IndexedDB 事务内删除储蓄目标及其全部月度计划。 */
export async function deleteSavingsGoalAndPlans(goalId: string) {
  return withSavingsState(goalId, (goal, plans, goals, store) => {
    if (goal && savingsFundOutstanding(goal) > 0) throw new Error("该目标还有未补齐取用，请补齐后再删除。");
    plans.filter((plan) => plan.goalId === goalId).forEach((plan) => store.delete(plan.id));
    goals.delete(goalId);
  });
}

/**
 * 在同一 IndexedDB 事务内导入账单，并对其中已关联贷款的还款更新贷款余额。
 * 只会处理本次通过流水 ID、备份原始 ID 和订单号去重后真正写入的流水，避免重复导入再次冲销贷款。
 */
export async function importTransactionsAndApplyLoanRepayments(transactions: Transaction[]): Promise<ImportResult> {
  if (!transactions.length) return { imported: 0, skipped: 0, errors: 0, loanRepayments: 0, loanRepaymentAmount: 0 };
  const db = await openDb();
  return new Promise<ImportResult>((resolve, reject) => {
    const transaction = db.transaction(["transactions", "loans"], "readwrite");
    const transactionStore = transaction.objectStore("transactions");
    const loanStore = transaction.objectStore("loans");
    const existingRequest = transactionStore.getAll();
    const loansRequest = loanStore.getAll();
    let existingTransactions: Transaction[] | null = null;
    let loans: Loan[] | null = null;
    let result: ImportResult | null = null;

    const applyImport = () => {
      if (!existingTransactions || !loans) return;
      const accountId = transactions[0]?.accountId;
      const existingOrderIds = new Set(
        existingTransactions
          .filter((item) => item.accountId === accountId)
          .map((item) => item.orderId)
          .filter((item): item is string => Boolean(item)),
      );
      const existingTransactionIds = new Set(
        existingTransactions.filter((item) => item.accountId === accountId).map((item) => item.id),
      );
      const pending = transactions.filter((item) => {
        if (existingTransactionIds.has(item.id) || (item.sourceId && existingTransactionIds.has(item.sourceId)) || (item.orderId && existingOrderIds.has(item.orderId))) return false;
        existingTransactionIds.add(item.id);
        if (item.orderId) existingOrderIds.add(item.orderId);
        return true;
      });
      const loanById = new Map(loans.filter((loan) => loan.accountId === accountId).map((loan) => [loan.id, { ...loan }]));
      let loanRepayments = 0;
      let loanRepaymentAmount = 0;

      pending.forEach((item) => {
        transactionStore.put(item);
        if (item.type !== "REPAYMENT" || !item.loanId) return;
        const loan = loanById.get(item.loanId);
        if (!loan || loan.status === "PAID_OFF" || loan.remainingAmount <= 0) return;
        const reducedAmount = Math.min(item.amount, loan.remainingAmount);
        if (reducedAmount <= 0) return;
        loan.remainingAmount = Math.max(0, loan.remainingAmount - reducedAmount);
        if (loan.monthlyPayment > 0 && item.amount >= loan.monthlyPayment) {
          loan.paidPeriods = Math.min(loan.periods, loan.paidPeriods + 1);
        }
        loan.status = loan.remainingAmount <= 0 ? "PAID_OFF" : loan.status;
        loan.updatedAt = item.updatedAt;
        loanRepayments += 1;
        loanRepaymentAmount += reducedAmount;
      });
      loanById.forEach((loan, id) => {
        const original = loans?.find((item) => item.id === id);
        if (original && original !== loan && (original.remainingAmount !== loan.remainingAmount || original.paidPeriods !== loan.paidPeriods || original.status !== loan.status)) {
          loanStore.put(loan);
        }
      });
      result = {
        imported: pending.length,
        skipped: transactions.length - pending.length,
        errors: 0,
        loanRepayments,
        loanRepaymentAmount,
      };
    };

    existingRequest.onsuccess = () => {
      existingTransactions = (existingRequest.result ?? []) as Transaction[];
      applyImport();
    };
    loansRequest.onsuccess = () => {
      loans = (loansRequest.result ?? []) as Loan[];
      applyImport();
    };
    existingRequest.onerror = () => transaction.abort();
    loansRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(result ?? { imported: 0, skipped: 0, errors: 0 });
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 账单导入失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 账单导入已取消"));
  });
}

/**
 * 将已存在的账单转为关联贷款的还款流水，并在同一 IndexedDB 事务内更新贷款。
 * 仅处理尚未关联贷款的账单，规则重复应用不会再次冲销。
 */
export async function applyLoanRepaymentClassifications(transactions: Transaction[]): Promise<LoanRepaymentClassificationResult> {
  if (!transactions.length) return { applied: 0, amount: 0, skipped: 0 };
  const db = await openDb();
  return new Promise<LoanRepaymentClassificationResult>((resolve, reject) => {
    const transaction = db.transaction(["transactions", "loans"], "readwrite");
    const transactionStore = transaction.objectStore("transactions");
    const loanStore = transaction.objectStore("loans");
    const currentTransactionsRequest = transactionStore.getAll();
    const loansRequest = loanStore.getAll();
    let currentTransactions: Transaction[] | null = null;
    let loans: Loan[] | null = null;
    let result: LoanRepaymentClassificationResult | null = null;

    const applyClassifications = () => {
      if (!currentTransactions || !loans) return;
      const currentById = new Map(currentTransactions.map((item) => [item.id, item]));
      const loanById = new Map(loans.map((loan) => [loan.id, { ...loan }]));
      let applied = 0;
      let amount = 0;
      let skipped = 0;

      transactions.forEach((item) => {
        const current = currentById.get(item.id);
        if (!current || current.accountId !== item.accountId || current.loanId || item.type !== "REPAYMENT" || !item.loanId) {
          skipped += 1;
          return;
        }
        const loan = loanById.get(item.loanId);
        if (!loan || loan.accountId !== item.accountId || loan.status === "PAID_OFF" || loan.remainingAmount <= 0) {
          skipped += 1;
          return;
        }
        const updatedTransaction = { ...current, ...item };
        const reducedAmount = Math.min(updatedTransaction.amount, loan.remainingAmount);
        if (reducedAmount <= 0) {
          skipped += 1;
          return;
        }
        transactionStore.put(updatedTransaction);
        loan.remainingAmount = Math.max(0, loan.remainingAmount - reducedAmount);
        if (loan.monthlyPayment > 0 && updatedTransaction.amount >= loan.monthlyPayment) {
          loan.paidPeriods = Math.min(loan.periods, loan.paidPeriods + 1);
        }
        loan.status = loan.remainingAmount <= 0 ? "PAID_OFF" : loan.status;
        loan.updatedAt = updatedTransaction.updatedAt;
        applied += 1;
        amount += reducedAmount;
      });
      loanById.forEach((loan, id) => {
        const original = loans?.find((item) => item.id === id);
        if (original && (original.remainingAmount !== loan.remainingAmount || original.paidPeriods !== loan.paidPeriods || original.status !== loan.status)) {
          loanStore.put(loan);
        }
      });
      result = { applied, amount, skipped };
    };

    currentTransactionsRequest.onsuccess = () => {
      currentTransactions = (currentTransactionsRequest.result ?? []) as Transaction[];
      applyClassifications();
    };
    loansRequest.onsuccess = () => {
      loans = (loansRequest.result ?? []) as Loan[];
      applyClassifications();
    };
    currentTransactionsRequest.onerror = () => transaction.abort();
    loansRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(result ?? { applied: 0, amount: 0, skipped: transactions.length });
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 贷款还款归类失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 贷款还款归类已取消"));
  });
}

export async function recordSavingsDeposit(planId: string, input: SavingsDepositInput, accountId: string, now: string) {
  const plan = await getRecord<SavingsPlan>("savingsPlans", planId);
  if (!plan) throw new Error("储蓄计划不存在。");
  return withSavingsState(plan.goalId, (goal, plans, goals, store) => {
    const current = plans.find((item) => item.id === planId);
    if (!goal || !current || goal.accountId !== accountId) throw new Error("储蓄计划不存在或不属于当前账本。");
    if (current.status === "COMPLETED" && Math.round((current.actualAmount ?? current.amount) * 100) === input.amountCents && current.actualDate === input.date && (current.proofImage ?? null) === input.proofImage) return;
    if (current.updatedAt !== input.expectedUpdatedAt) throw new Error("存入记录已变更，请刷新后再修改。");
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 1e12 || Number.isNaN(new Date(input.date.replace(" ", "T")).getTime())) throw new Error("请核对金额和日期。");
    const next = recordSavingsPlanDeposit(current, goal, input.amountCents / 100, input.proofImage, now, input.date);
    assertSavingsPlanFundChange(goal, current, next.plan);
    const nextPlans = [...plans.filter((item) => item.id !== planId), next.plan];
    goals.put(preserveSavingsFund(next.goal, goal, nextPlans));
    store.put(next.plan);
  });
}

/** Restore into a new account in one IndexedDB transaction. */
export async function importLocalLedgerWorkbook(input: import("../export/ledger-workbook").LedgerWorkbook) {
  const { prepareLocalWorkbook } = await import("../import/ledger-workbook");
  const { accountId, sheets } = prepareLocalWorkbook("local-user", input);
  const db = await openDb();
  return new Promise<import("../export/ledger-workbook").WorkbookImportResult>((resolve, reject) => {
    const tables = Object.keys(sheets) as StoreName[];
    const transaction = db.transaction(tables, "readwrite");
    let imported = 0;
    let reused = false;
    const existing = transaction.objectStore("accounts").get(accountId);
    existing.onsuccess = () => {
      if (existing.result) { reused = true; return; }
      const themes = transaction.objectStore("themeConfigs").getAll();
      themes.onsuccess = () => {
        try {
          const currentTheme = (themes.result as ThemeConfig[]).find((row) => row.userId === "local-user");
          for (const table of tables) for (const row of sheets[table as keyof typeof sheets]) {
            if (table === "themeConfigs" && currentTheme) {
              transaction.objectStore(table).put({ ...row, id: currentTheme.id });
            } else transaction.objectStore(table).add(row);
            imported += 1;
          }
        } catch { transaction.abort(); }
      };
    };
    transaction.oncomplete = () => resolve({ accountId, imported, reused });
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("工作簿导入失败，未写入数据"));
  });
}
