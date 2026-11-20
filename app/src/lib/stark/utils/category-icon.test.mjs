import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { categoryIconSrc, categoryIconSrcForCategory, expenseCategoryOptions } from "./category-icon.ts";
import { isShoppingAnalysisCategory } from "../dashboard/shopping-analysis.ts";

const addedCategories = [
  "米面粮油", "调料", "蛋奶", "速食", "干货", "箱包", "配饰", "机票车票", "过路费", "住宿",
  "快递跑腿", "洗衣洗鞋", "搬家", "体检", "牙科", "康复理疗", "宠物食品", "宠物洗护", "宠物医疗", "宠物寄养",
  "数码配件", "AI订阅", "API", "软件应用", "云盘备份", "云服务器", "域名建站", "网络加速", "游戏购买", "游戏充值",
  "数字阅读", "短剧付费", "素材授权", "文具办公", "在线课程", "演出展览", "公益捐赠",
];

test("all 37 supplied categories are selectable and have distinct production WebP assets", () => {
  assert.equal(addedCategories.length, 37);
  const icons = [];
  for (const category of addedCategories) {
    assert.equal(expenseCategoryOptions.filter((value) => value === category).length, 1, category);
    const src = categoryIconSrcForCategory(category, "EXPENSE");
    assert.notEqual(src, categoryIconSrcForCategory("其他", "EXPENSE"), category);
    assert.equal(categoryIconSrc({ category, type: "EXPENSE" }), src);
    const file = readFileSync(new URL(`../../../../public${src}`, import.meta.url));
    assert.equal(file.toString("ascii", 0, 4), "RIFF", category);
    assert.equal(file.toString("ascii", 8, 12), "WEBP", category);
    icons.push(src);
  }
  assert.equal(new Set(icons).size, 37);
  assert.equal(new Set(expenseCategoryOptions).size, expenseCategoryOptions.length);
  assert.equal(expenseCategoryOptions.at(-1), "其他");
});

test("existing expense and income icons retain their mappings and special transaction types", () => {
  assert.equal(categoryIconSrcForCategory("餐饮", "EXPENSE"), "/category-icons/food-drink/canyinlei.webp");
  assert.equal(categoryIconSrcForCategory("电子产品", "EXPENSE"), "/category-icons/digital/dianzichanp-optimized.webp");
  assert.equal(categoryIconSrcForCategory("工资", "INCOME"), "/category-icons/income/gongjulei.webp");
  assert.equal(categoryIconSrcForCategory("API", "TRANSFER"), categoryIconSrcForCategory("转账", "TRANSFER"));
  for (const category of ["工资", "退款", "转账", "还款"]) assert.ok(!expenseCategoryOptions.includes(category));
});

test("personal transfers retain their lending direction while loan repayments keep repayment semantics", () => {
  const categories = ["借出", "借入", "收回借款", "归还借款"];
  const transferIcon = categoryIconSrcForCategory("转账", "TRANSFER");
  const repaymentIcon = categoryIconSrcForCategory("贷款还款", "REPAYMENT");
  const icons = categories.map((category) => {
    const icon = categoryIconSrcForCategory(category, "TRANSFER");
    assert.notEqual(icon, transferIcon);
    assert.notEqual(icon, repaymentIcon);
    assert.equal(categoryIconSrc({ category, type: "TRANSFER" }), icon);
    assert.equal(categoryIconSrcForCategory(` ${category} `, "TRANSFER"), icon);
    assert.equal(categoryIconSrcForCategory(category, "REPAYMENT"), repaymentIcon);
    assert.equal(categoryIconSrc({ category, type: "REPAYMENT" }), repaymentIcon);
    assert.ok(!expenseCategoryOptions.includes(category));
    return icon;
  });
  assert.equal(new Set(icons).size, 4);
  assert.equal(categoryIconSrcForCategory("还款"), repaymentIcon);
  assert.equal(categoryIconSrcForCategory("贷款还款"), repaymentIcon);
  assert.ok(!expenseCategoryOptions.includes("贷款还款"));
});

test("both AI backends offer exactly the categories accepted by the journal picker", () => {
  for (const file of [
    "../../../../../server-go/internal/httpapi/screenshot_recognition.go",
    "../../../../../api-server/src/main/kotlin/com/wotty/stark/server/route/ScreenshotRecognitionRoutes.kt",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const categories = source.match(/分类必须从这些值中选最贴合的一项：([^。]+)。/)[1].split("、");
    assert.deepEqual(categories, expenseCategoryOptions, file);
    assert.match(source, /AI订阅用于 AI 会员或订阅套餐，API用于接口调用或 Token 用量付费/);
    assert.match(source, /游戏购买与游戏充值分开，宠物医疗与人员医疗分开/);
  }
});

test("retail subdivisions remain in shopping analysis while service categories stay separate", () => {
  for (const category of ["箱包", "配饰", "宠物食品", "数码配件", "文具办公"]) {
    assert.equal(isShoppingAnalysisCategory(category), true, category);
  }
  for (const category of ["宠物医疗", "宠物洗护", "宠物寄养", "AI订阅", "API", "住宿", "快递跑腿", "洗衣洗鞋"]) {
    assert.equal(isShoppingAnalysisCategory(category), false, category);
  }
});
