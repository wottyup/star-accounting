import type { TransactionType } from "@/lib/stark/models";
import { categoryIconSrcForCategory } from "./category-icon.ts";
import { personalLoanCategories } from "../journal/personal-loan.ts";

const expenseGroups = [
  ["food-drink", "餐饮食品"],
  ["shopping-clothing", "购物穿搭"],
  ["transport-travel", "交通出行"],
  ["home-living", "居家生活"],
  ["personal-care", "个人护理"],
  ["family-pets", "家庭宠物"],
  ["healthcare", "医疗健康"],
  ["sports-outdoors", "运动户外"],
  ["education-entertainment", "文教娱乐"],
  ["digital", "数码服务"],
  ["gifts-social", "人情公益"],
  ["finance-fees", "保险税费"],
  ["tobacco", "烟草"],
  ["common", "其他"],
] as const;

export type JournalCategoryGroup = { id: string; label: string; categories: string[] };

/** Follow the existing artwork folders; transaction type takes priority over shared artwork. */
export function groupJournalCategories(categories: string[], type: TransactionType): JournalCategoryGroup[] {
  if (categories.length === 0) return [];
  if (type !== "EXPENSE") {
    const isPersonalLoan = (category: string) => personalLoanCategories.some((value) => value === category);
    return [
      { id: type, label: type === "INCOME" ? "收入" : "转账", categories: categories.filter((category) => !isPersonalLoan(category)) },
      { id: "gifts-social", label: "人情公益", categories: categories.filter(isPersonalLoan) },
    ].filter((group) => group.categories.length > 0);
  }
  const groups: JournalCategoryGroup[] = expenseGroups.map(([id, label]) => ({ id, label, categories: [] }));
  const byFolder = new Map(groups.map((group) => [group.id, group]));
  for (const category of categories) {
    const folder = categoryIconSrcForCategory(category, type).split("/").at(-2) ?? "common";
    (byFolder.get(folder) ?? byFolder.get("common")!).categories.push(category);
  }
  return groups.filter((group) => group.categories.length > 0);
}
