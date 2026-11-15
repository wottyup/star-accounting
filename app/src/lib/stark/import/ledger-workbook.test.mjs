import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prepareLocalWorkbook } from "./ledger-workbook.ts";

const fixture = () => JSON.parse(readFileSync(new URL("../../../../../testdata/ledger-workbook.json", import.meta.url), "utf8"));
test("local restore preserves amounts and rebinds every module and fund allocation", () => {
  const input = fixture();
  const original = structuredClone(input);
  const { accountId, sheets } = prepareLocalWorkbook("local-user", input);
  assert.equal(sheets.accounts[0].ownerId, "local-user");
  assert.equal(sheets.accounts[0].openingBalance, 250.35);
  assert.equal(sheets.assets[0].balance, 1000.25);
  assert.equal(sheets.budgets[0].amount, 2000);
  assert.equal(sheets.loans[0].remainingAmount, 900);
  assert.equal(sheets.transactions[1].loanId, sheets.loans[0].id);
  assert.equal(sheets.savingsPlans[0].goalId, sheets.savingsGoals[0].id);
  const funds = JSON.parse(sheets.savingsGoals[0].fundMovements);
  assert.equal(funds[0].allocations[0].planId, sheets.savingsPlans[0].id);
  assert.equal(funds[1].withdrawalId, funds[0].id);
  assert.equal(sheets.transactions[0].id, `subscription-${sheets.subscriptions[0].id}-2026-11`);
  assert.equal(sheets.transactions[0].orderId, `subscription:${sheets.subscriptions[0].id}:2026-11`);
  assert.equal(prepareLocalWorkbook("local-user", input).accountId, accountId);
  assert.notEqual(prepareLocalWorkbook("other-user", input).accountId, accountId);
  assert.deepEqual(input, original);
});

test("local restore rejects foreign accounts, damaged references, and excessive replenishments", () => {
  for (const change of [
    (w) => { w.sheets.assets[0].accountId = "foreign-account"; },
    (w) => { w.sheets.savingsPlans[0].goalId = "missing"; },
    (w) => { w.sheets.savingsPlans[0].actualAmount = 1; },
    (w) => { w.sheets.users = []; delete w.sheets.budgets; },
    (w) => {
      const funds = JSON.parse(w.sheets.savingsGoals[0].fundMovements);
      funds[1].amountCents = funds[1].allocations[0].cents = 30000;
      w.sheets.savingsGoals[0].fundMovements = JSON.stringify(funds);
    },
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => prepareLocalWorkbook("local-user", input));
  }
});
