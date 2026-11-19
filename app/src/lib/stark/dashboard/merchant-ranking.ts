import type { Transaction } from "@/lib/stark/models";

export type MerchantRankingItem = {
  merchant: string;
  amount: number;
  count: number;
};

export const UNKNOWN_MERCHANT = "未注明去向";

/** 按支出流水的交易对方汇总，名称可以是商家、个人或填写的用途。 */
export function buildMerchantRanking(transactions: Transaction[], limit = 10): MerchantRankingItem[] {
  const totals = new Map<string, MerchantRankingItem>();

  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE" || transaction.amount <= 0) continue;
    const merchant = transaction.merchant?.trim() || UNKNOWN_MERCHANT;
    const previous = totals.get(merchant);
    if (previous) {
      previous.amount += transaction.amount;
      previous.count += 1;
    } else {
      totals.set(merchant, { merchant, amount: transaction.amount, count: 1 });
    }
  }

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
  return [...totals.values()]
    .sort((a, b) => b.amount - a.amount || b.count - a.count || a.merchant.localeCompare(b.merchant, "zh-CN"))
    .slice(0, safeLimit);
}
