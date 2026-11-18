import assert from "node:assert/strict";
import test from "node:test";
import { applyScreenshotRecognition, hasSharedRecognitionCategory, prepareJournalDrafts } from "./recognition-drafts.ts";

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

test("recognition preserves different AI categories and refunds with shared payment choices", () => {
  const recognized = [
    item("fruit", "18.50", { category: "水果" }),
    item("ride", "25.00", { category: "打车" }),
    item("refund", "4.80", { type: "INCOME", category: "退款" }),
  ];
  const applied = applyScreenshotRecognition(recognized, form(), { platform: "支付宝" });

  assert.equal(hasSharedRecognitionCategory(applied), false);
  assert.deepEqual(applied.map(({ type, category }) => ({ type, category })),
    recognized.map(({ type, category }) => ({ type, category })));
  assert.ok(applied.every((draft) => draft.platform === "支付宝"));
});

test("saving, restoring, switching items and retrying do not overwrite individual categories", () => {
  const recognized = [item("fruit", "18.50", { category: "水果" }), item("ride", "25.00", { category: "打车" })];
  const applied = applyScreenshotRecognition(recognized, form(), {});
  applied[1] = { ...applied[1], category: "公交地铁" };
  const saved = prepareJournalDrafts(form({ category: "水果" }), applied);
  const restored = JSON.parse(JSON.stringify(saved));
  const switched = prepareJournalDrafts({ ...restored[1], ...form({ category: "水果", platform: "微信" }) }, restored);
  const retried = prepareJournalDrafts(form({ category: "餐饮", platform: "现金" }), switched);

  assert.deepEqual(retried.map((draft) => draft.category), ["水果", "公交地铁"]);
  assert.ok(retried.every((draft) => draft.platform === "现金"));
});

test("common category mode follows edits, deletion and transaction type differences", () => {
  const drafts = [item("first", "18.50", { category: "水果" }), item("last", "25.00", { category: "打车" })];
  assert.equal(hasSharedRecognitionCategory(drafts), false);
  assert.equal(hasSharedRecognitionCategory(drafts.slice(1)), true);
  const unified = drafts.map((draft) => ({ ...draft, category: "水果" }));
  assert.equal(hasSharedRecognitionCategory(unified), true);
  assert.equal(hasSharedRecognitionCategory([
    item("expense", "10.00", { category: "其他" }),
    item("income", "5.00", { type: "INCOME", category: "其他" }),
  ]), false);
  assert.equal(hasSharedRecognitionCategory([]), false);
});

test("removing the first mixed item and returning to a single form keeps the surviving classification", () => {
  const drafts = applyScreenshotRecognition([
    item("fruit", "18.50", { category: "水果" }),
    item("refund", "4.80", { type: "INCOME", category: "退款" }),
  ], form(), {});
  const remaining = prepareJournalDrafts(form(), drafts).slice(1);
  const [saved] = prepareJournalDrafts({ ...remaining[0], amount: "5.00" }, remaining);

  assert.equal(saved.type, "INCOME");
  assert.equal(saved.category, "退款");
  assert.equal(saved.id, "refund");
  assert.equal(saved.amount, "5.00");
});
