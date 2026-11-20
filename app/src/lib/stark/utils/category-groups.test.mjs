import assert from "node:assert/strict";
import test from "node:test";
import { groupJournalCategories } from "./category-groups.ts";
import { expenseCategoryOptions, incomeCategoryOptions } from "./category-icon.ts";

test("every expense category remains reachable exactly once in its artwork group", () => {
  const groups = groupJournalCategories(expenseCategoryOptions, "EXPENSE");
  const flattened = groups.flatMap((group) => group.categories);
  assert.equal(flattened.length, expenseCategoryOptions.length);
  assert.equal(new Set(flattened).size, expenseCategoryOptions.length);
  assert.deepEqual([...flattened].sort(), [...expenseCategoryOptions].sort());
  assert.equal(groups.at(-1).id, "common");
  assert.ok(groups.find((group) => group.id === "digital").categories.includes("AI订阅"));
  assert.ok(groups.find((group) => group.id === "digital").categories.includes("API"));
  for (const group of groups) {
    assert.deepEqual(group.categories, expenseCategoryOptions.filter((category) => group.categories.includes(category)));
  }
});

test("shared income and transfer artwork never assigns those entries to expense groups", () => {
  const income = ["工资", "奖金", "理财", "退款", "其他"];
  assert.deepEqual(groupJournalCategories(income, "INCOME"), [{ id: "INCOME", label: "收入", categories: income }]);
  assert.deepEqual(groupJournalCategories(["转账"], "TRANSFER"), [{ id: "TRANSFER", label: "转账", categories: ["转账"] }]);
});

test("all four lending actions stay together under Gifts and charity in either picker", () => {
  const actions = ["借出", "借入", "收回借款", "归还借款"];
  for (const [categories, type] of [[expenseCategoryOptions, "EXPENSE"], [incomeCategoryOptions, "INCOME"]]) {
    const groups = groupJournalCategories(categories, type);
    const social = groups.find((group) => group.id === "gifts-social");
    assert.equal(social.label, "人情公益");
    assert.deepEqual(social.categories.filter((category) => actions.includes(category)), actions);
    for (const action of actions) {
      assert.equal(groups.flatMap((group) => group.categories).filter((category) => category === action).length, 1);
    }
  }
});

test("tobacco and legacy cigarette categories stay out of food and drinks", () => {
  const groups = groupJournalCategories(expenseCategoryOptions, "EXPENSE");
  assert.ok(!groups.find((group) => group.id === "food-drink").categories.includes("烟草"));
  assert.deepEqual(groups.find((group) => group.id === "tobacco"), {
    id: "tobacco", label: "烟草", categories: ["烟草"],
  });
  assert.deepEqual(groupJournalCategories(["香烟"], "EXPENSE"), [
    { id: "tobacco", label: "烟草", categories: ["香烟"] },
  ]);
});

test("filtered options omit empty groups and preserve unknown categories under Other", () => {
  assert.deepEqual(groupJournalCategories(["API", "AI订阅", "自定义分类"], "EXPENSE"), [
    { id: "digital", label: "数码服务", categories: ["API", "AI订阅"] },
    { id: "common", label: "其他", categories: ["自定义分类"] },
  ]);
  assert.deepEqual(groupJournalCategories([], "EXPENSE"), []);
});
