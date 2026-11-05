import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createSheetLayerCoordinator } from "./sheet-layer-coordinator.ts";

test("nested sheets keep one navigation handoff until the last layer leaves", async () => {
  let captures = 0;
  let restores = 0;
  const acquire = createSheetLayerCoordinator(async () => {
    captures += 1;
    return async () => { restores += 1; };
  });
  const parent = acquire();
  const picker = acquire();
  await Promise.all([parent.ready, picker.ready]);
  assert.equal(captures, 1);
  await picker.release();
  assert.equal(restores, 0);
  await parent.release();
  assert.equal(restores, 1);
  await parent.release();
  assert.equal(restores, 1);
});

test("Strict Mode effect replay does not restore navigation between mounts", async () => {
  let captures = 0;
  let restores = 0;
  const acquire = createSheetLayerCoordinator(async () => {
    captures += 1;
    return async () => { restores += 1; };
  });
  const first = acquire();
  const cleanup = first.release();
  const replay = acquire();
  await Promise.all([cleanup, replay.ready]);
  assert.equal(captures, 1);
  assert.equal(restores, 0);
  await replay.release();
  assert.equal(restores, 1);
});

test("closing while capture is pending restores it before a new sheet can enter", async () => {
  const capture = Promise.withResolvers();
  const restore = Promise.withResolvers();
  const events = [];
  const acquire = createSheetLayerCoordinator(async () => {
    events.push("capture");
    if (events.length === 1) {
      await capture.promise;
      return async () => {
        events.push("restore-start");
        await restore.promise;
        events.push("restore-end");
      };
    }
    return async () => { events.push("restore-next"); };
  });
  const first = acquire();
  await setImmediate();
  const closing = first.release();
  await setImmediate();
  const next = acquire();
  let nextReady = false;
  void next.ready.then(() => { nextReady = true; });
  capture.resolve();
  await setImmediate();
  assert.deepEqual(events, ["capture", "restore-start"]);
  assert.equal(nextReady, false);
  restore.resolve();
  await Promise.all([closing, next.ready]);
  assert.deepEqual(events, ["capture", "restore-start", "restore-end", "capture"]);
  await next.release();
});

test("a failed capture does not block the sheet or poison the next handoff", async () => {
  let attempts = 0;
  let restores = 0;
  const acquire = createSheetLayerCoordinator(async () => {
    if (++attempts === 1) throw new Error("bridge unavailable");
    return async () => { restores += 1; };
  });
  const first = acquire();
  await first.ready;
  await first.release();
  const next = acquire();
  await next.ready;
  await next.release();
  assert.equal(attempts, 2);
  assert.equal(restores, 1);
});

test("a failed restoration cannot deadlock the next opening", async () => {
  let attempts = 0;
  const acquire = createSheetLayerCoordinator(async () => {
    const attempt = ++attempts;
    return async () => { if (attempt === 1) throw new Error("activity replaced"); };
  });
  const first = acquire();
  await first.ready;
  await first.release();
  const next = acquire();
  await next.ready;
  assert.equal(attempts, 2);
  await next.release();
});
