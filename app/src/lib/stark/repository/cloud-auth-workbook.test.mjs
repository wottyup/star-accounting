import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../../../${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { cloudMe } = await import("./cloud-auth.ts");
const { setCloudAuth } = await import("../storage/cloud-auth.ts");
const { setCurrentAccountId, getCurrentAccountId } = await import("../storage/local-config.ts");
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("session refresh keeps an accessible imported ledger and rejects unavailable selections", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = { localStorage: storage(), sessionStorage: storage(), setTimeout, clearTimeout };
  const user = { id: "test-user", email: "test@example.invalid", defaultAccountId: "original-ledger", role: "USER", createdAt: "2026-11-15", updatedAt: "2026-11-15" };
  setCloudAuth("synthetic-test-session", user, false);
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith("/api/auth/me") ? user : [{ id: "original-ledger" }, { id: "imported-ledger" }]));
  try {
    setCurrentAccountId("imported-ledger");
    await cloudMe("https://workbook-test.invalid");
    assert.equal(getCurrentAccountId(), "imported-ledger");
    setCurrentAccountId("foreign-or-deleted-ledger");
    await cloudMe("https://workbook-test.invalid");
    assert.equal(getCurrentAccountId(), "original-ledger");
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});
