import assert from "node:assert/strict";
import test from "node:test";
import { journalTypeForCategory, personalLoanCategories } from "./personal-loan.ts";
import { prepareJournalDrafts } from "./recognition-drafts.ts";
import { transactionBalanceEffect } from "../ledger/balance.ts";

const expectedTypes = ["EXPENSE", "INCOME", "INCOME", "EXPENSE"];
const draft = (category, type = "EXPENSE") => ({
  id: category, category, type, amount: "100", platform: "现金", merchant: "朋友",
  description: "", date: "2026-11-20T12:00",
});

test("lending categories resolve the same cash direction regardless of the starting tab", () => {
  personalLoanCategories.forEach((category, index) => {
    for (const startingType of ["EXPENSE", "INCOME", "TRANSFER"]) {
      const type = journalTypeForCategory(` ${category} `, startingType);
      assert.equal(type, expectedTypes[index]);
      assert.equal(transactionBalanceEffect({ amount: 100, type }), type === "INCOME" ? 100 : -100);
    }
    assert.equal(journalTypeForCategory(category, "REPAYMENT"), "REPAYMENT");
  });
  assert.equal(journalTypeForCategory("餐饮", "EXPENSE"), "EXPENSE");
  assert.equal(journalTypeForCategory("工资", "INCOME"), "INCOME");
  assert.equal(journalTypeForCategory("转账", "TRANSFER"), "TRANSFER");
});

test("saving a manual or restored single draft repairs a stale lending direction", () => {
  const current = draft("收回借款");
  assert.equal(prepareJournalDrafts(current, [])[0].type, "INCOME");
  assert.equal(prepareJournalDrafts(current, [draft("借出")])[0].type, "INCOME");
  assert.equal(current.type, "EXPENSE", "normalization must not mutate the stored draft");
});

test("mixed recognized lending keeps individual directions and identifiers through save preparation", () => {
  const recognized = personalLoanCategories.map((category) => draft(category, "TRANSFER"));
  const result = prepareJournalDrafts({ ...draft("餐饮"), platform: "银行卡" }, recognized);
  assert.deepEqual(result.map((item) => item.type), expectedTypes);
  assert.deepEqual(result.map((item) => item.category), [...personalLoanCategories]);
  assert.deepEqual(result.map((item) => item.id), [...personalLoanCategories]);
  assert.ok(result.every((item) => item.platform === "银行卡"));
  assert.ok(recognized.every((item) => item.type === "TRANSFER"));
});
