const SHOPPING_ANALYSIS_CATEGORIES = new Set([
  "购物", "购物消费", "网购", "日用", "日用百货", "生活用品", "百货",
  "服装", "服饰", "服饰装扮", "鞋类", "箱包", "配饰", "美容", "个人护理", "宠物", "宠物食品", "母婴", "玩具", "礼物",
  "电子产品", "数码配件", "家具", "家电", "图书", "文具办公", "工具", "户外", "清洁", "清洁优化", "日常清洁",
]);

/** 商品零售和日常用品类分类，用于消费页购物分析。 */
export function isShoppingAnalysisCategory(category: string | null | undefined) {
  const normalized = category?.trim();
  if (!normalized) return false;
  return normalized.includes("购") || SHOPPING_ANALYSIS_CATEGORIES.has(normalized);
}
