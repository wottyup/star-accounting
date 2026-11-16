import assert from "node:assert/strict";
import test from "node:test";
import { finishScreenshotCleanup } from "./screenshot-cleanup.ts";

function actions({ consent = true, status = "deleted", failure = false } = {}) {
  const calls = [];
  return {
    calls,
    confirm: async () => { calls.push("confirm"); return consent; },
    remove: async (id) => {
      calls.push(["remove", id]);
      if (failure) throw new Error("permission expired");
      return { status };
    },
    forget: async (id) => { calls.push(["forget", id]); },
    unavailable: async () => { calls.push("unavailable"); },
  };
}

test("manual/browser entries with no source never prompt or delete", async () => {
  const api = actions();
  await finishScreenshotCleanup(undefined, api);
  assert.deepEqual(api.calls, []);
});

test("keeping a screenshot releases its handle without deleting the photo", async () => {
  const api = actions({ consent: false });
  await finishScreenshotCleanup("chosen-image", api);
  assert.deepEqual(api.calls, ["confirm", ["forget", "chosen-image"]]);
});

test("confirmation deletes only the exact selected source", async () => {
  const api = actions();
  await finishScreenshotCleanup("chosen-image", api);
  assert.deepEqual(api.calls, ["confirm", ["remove", "chosen-image"], ["forget", "chosen-image"]]);
});

test("cancelling the system deletion dialog keeps the photo without reporting an error", async () => {
  const api = actions({ status: "cancelled" });
  await finishScreenshotCleanup("chosen-image", api);
  assert.equal(api.calls.includes("unavailable"), false);
});

test("read-only or expired sources explain manual deletion and retain saved entries", async () => {
  for (const options of [{ status: "unavailable" }, { failure: true }]) {
    const api = actions(options);
    await assert.doesNotReject(() => finishScreenshotCleanup("chosen-image", api));
    assert.equal(api.calls.filter((call) => call === "unavailable").length, 1);
    assert.deepEqual(api.calls.at(-1), ["forget", "chosen-image"]);
  }
});

test("failure to display a notice or release a grant never becomes an accounting failure", async () => {
  const api = actions({ failure: true });
  api.unavailable = async () => { throw new Error("page closed"); };
  api.forget = async () => { throw new Error("bridge gone"); };
  await assert.doesNotReject(() => finishScreenshotCleanup("chosen-image", api));
});
