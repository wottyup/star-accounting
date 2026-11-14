import assert from "node:assert/strict";
import test from "node:test";
import { applyScreenshotRecognition, prepareJournalDrafts } from "./recognition-drafts.ts";

const item = (id, amount, overrides = {}) => ({
  id,
  type: "EXPENSE",
  amount,
  category: "买菜",
  platform: "其他",
  shoppingPlatform: "小象超市",
  merchant: `商户-${id}`,
  description: `商品-${id}`,
  date: "2026-11-12T16:11",
  ...overrides,
});

const form = (overrides = {}) => item("active", "", {
  platform: "支付宝",
  date: "2026-11-12T18:11",
  merchant: "",
  description: "",
  ...overrides,
});

test("applies the visible account and changed time to every item with different recognition metadata", () => {
  const recognized = [
    item("ginger", "4.98"),
    item("mushroom", "5.30", { platform: "微信", date: "2026-11-11T12:00" }),
    item("pepper", "8.85", { platform: "支付宝" }),
  ];
  const before = structuredClone(recognized);
  const prepared = prepareJournalDrafts(form(), recognized);

  assert.deepEqual(prepared.map((draft) => draft.platform), ["支付宝", "支付宝", "支付宝"]);
  assert.deepEqual(prepared.map((draft) => draft.date), Array(3).fill("2026-11-12T18:11"));
  assert.deepEqual(prepared.map(({ id, amount, merchant, description }) => ({ id, amount, merchant, description })),
    recognized.map(({ id, amount, merchant, description }) => ({ id, amount, merchant, description })));
  assert.deepEqual(recognized, before);
});

test("restored old drafts and switching active items cannot restore an old account or time", () => {
  const restored = JSON.parse(JSON.stringify({
    ...form(),
    recognizedDrafts: [item("first", "4.98"), item("second", "5.30"), item("third", "8.85")],
    activeRecognizedDraftIndex: 2,
  }));
  const prepared = prepareJournalDrafts(restored, restored.recognizedDrafts);
  const selected = { ...prepared[0], ...form({ platform: "微信", date: "2026-11-10T09:25" }) };
  const persisted = JSON.parse(JSON.stringify(prepareJournalDrafts(selected, prepared)));

  assert.ok(persisted.every((draft) => draft.platform === "微信" && draft.date === "2026-11-10T09:25"));
  assert.deepEqual(persisted.map((draft) => draft.id), ["first", "second", "third"]);
});

test("removing all but one item keeps its amount, details, stable ID and shared choices", () => {
  const prepared = prepareJournalDrafts(form(), [item("first", "4.98"), item("last", "8.85")]);
  const remaining = prepared.slice(1);
  const [saved] = prepareJournalDrafts(remaining[0], remaining);

  assert.equal(saved.id, "last");
  assert.equal(saved.amount, "8.85");
  assert.equal(saved.description, "商品-last");
  assert.equal(saved.platform, "支付宝");
  assert.equal(saved.date, "2026-11-12T18:11");
});

test("a prepared save snapshot keeps shared fields stable during sequential saves and retries", () => {
  const current = form();
  const recognized = [item("first", "4.98"), item("last", "8.85")];
  const pending = prepareJournalDrafts(current, recognized);
  current.platform = "现金";
  current.date = "2026-11-13T20:00";

  assert.ok(pending.every((draft) => draft.platform === "支付宝" && draft.date === "2026-11-12T18:11"));
  const retried = prepareJournalDrafts(current, pending);
  assert.ok(retried.every((draft) => draft.platform === "现金" && draft.date === "2026-11-13T20:00"));
  assert.deepEqual(retried.map((draft) => draft.id), pending.map((draft) => draft.id));
});

test("manual choices win over a late recognition response, including the same choice as the default", () => {
  const recognized = [item("first", "4.98", { platform: "微信" }), item("last", "8.85")];
  const overrides = { platform: "支付宝", date: "2026-11-12T18:11", shoppingPlatform: "盒马" };
  const applied = applyScreenshotRecognition(recognized, form(), overrides);
  const restored = JSON.parse(JSON.stringify({ ...applied[0], recognitionOverrides: overrides }));
  const reapplied = applyScreenshotRecognition(recognized, restored, restored.recognitionOverrides);

  assert.ok(reapplied.every((draft) => draft.platform === "支付宝"
    && draft.date === "2026-11-12T18:11" && draft.shoppingPlatform === "盒马"));
  assert.deepEqual(reapplied.map((draft) => draft.amount), ["4.98", "8.85"]);
});

test("recognition still fills a known account and time when the user has not overridden them", () => {
  const applied = applyScreenshotRecognition([
    item("first", "4.98", { platform: "微信" }),
    item("last", "8.85", { platform: "银行卡", date: "2026-11-11T10:00" }),
  ], form(), {});

  assert.ok(applied.every((draft) => draft.platform === "微信" && draft.date === "2026-11-12T16:11"));
  assert.equal(applied[0].shoppingPlatform, "小象超市");
});

test("single recognition and manual editing keep the current form amount and details", () => {
  const recognized = [item("only", "4.98")];
  const current = { ...recognized[0], ...form({ amount: "6.50", merchant: "店铺", description: "修改后的商品" }) };
  delete current.id;
  const [saved] = prepareJournalDrafts(current, recognized);

  assert.equal(saved.id, "only");
  assert.equal(saved.amount, "6.50");
  assert.equal(saved.merchant, "店铺");
  assert.equal(saved.description, "修改后的商品");
  assert.deepEqual(prepareJournalDrafts(current, []), [current]);
  assert.deepEqual(applyScreenshotRecognition([], current, {}), []);
});
