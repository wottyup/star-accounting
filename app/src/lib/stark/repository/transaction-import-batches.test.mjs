import assert from "node:assert/strict";
import test from "node:test";
import { importTransactionBatches } from "./transaction-import-batches.ts";

const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: `tx-${index}`, description: "购物明细" }));
const success = (body) => ({ imported: JSON.parse(body).length, skipped: 0, errors: 0 });

test("13411 bills stay ordered in 14 bounded requests with confirmed progress", async () => {
  const input = rows(13411);
  const sent = [];
  const progress = [];
  const result = await importTransactionBatches(input, async body => {
    sent.push(JSON.parse(body));
    return success(body);
  }, (completed, total) => progress.push([completed, total]));
  assert.equal(result.imported, 13411);
  assert.equal(sent.length, 14);
  assert.deepEqual(sent.flat(), input);
  assert.deepEqual(progress.at(-1), [13411, 13411]);
  assert.equal(progress[0][0], 1000);
});

test("Chinese and emoji content splits by UTF-8 bytes, not character count", async () => {
  const input = rows(1200).map(row => ({ ...row, description: "购物🛍️".repeat(300) }));
  const received = [];
  await importTransactionBatches(input, async body => {
    assert.ok(Buffer.byteLength(body) <= 768 * 1024);
    assert.ok(JSON.parse(body).length <= 1000);
    received.push(...JSON.parse(body));
    return success(body);
  });
  assert.deepEqual(received, input);
});

test("variable-size batches preserve original failure row numbers and loan totals", async () => {
  const input = rows(5).map(row => ({ ...row, description: "大".repeat(100000) }));
  const counts = [];
  const result = await importTransactionBatches(input, async body => {
    const count = JSON.parse(body).length;
    counts.push(count);
    return { imported: count - 1, skipped: 0, errors: 1, failedRows: [{ lineNumber: count, rawData: "bad", errorMessage: "bad", errorType: "IMPORT" }], loanRepayments: 1, loanRepaymentAmount: 10 };
  });
  assert.deepEqual(counts, [2, 2, 1]);
  assert.deepEqual(result.failedRows.map(row => row.lineNumber), [2, 4, 5]);
  assert.equal(result.imported + result.errors, 5);
  assert.equal(result.loanRepayments, 3);
  assert.equal(result.loanRepaymentAmount, 30);
});

test("network failure stops later batches and never confirms unsaved progress", async () => {
  let requests = 0;
  const progress = [];
  await assert.rejects(importTransactionBatches(rows(3000), async body => {
    if (++requests === 2) throw new Error("offline");
    return success(body);
  }, count => progress.push(count)), /offline/);
  assert.equal(requests, 2);
  assert.deepEqual(progress, [1000]);
});

test("oversized individual row gives its original line number without submitting it", async () => {
  let requests = 0;
  await assert.rejects(importTransactionBatches([{ id: "huge", description: "大".repeat(300000) }], async () => { requests++; }), /第 1 笔账单内容过大/);
  assert.equal(requests, 0);
});
