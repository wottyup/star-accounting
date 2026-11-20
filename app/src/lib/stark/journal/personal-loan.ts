import type { TransactionType } from "../models/types";

export const personalLoanCategories = ["借出", "借入", "收回借款", "归还借款"] as const;

/** Personal lending uses the existing cash-in/cash-out transaction types. */
export function journalTypeForCategory(category: string, fallback: TransactionType): TransactionType {
  // A linked loan repayment must keep its separate repayment accounting.
  if (fallback === "REPAYMENT") return fallback;
  switch (category.trim()) {
    case "借出":
    case "归还借款":
      return "EXPENSE";
    case "借入":
    case "收回借款":
      return "INCOME";
    default:
      return fallback;
  }
}
