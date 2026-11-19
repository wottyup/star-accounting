import assert from "node:assert/strict";
import test from "node:test";
import { APP_UPDATE_URL, fetchLatestAppVersion, hasNewerAppVersion } from "./app-version.ts";

const tag = "v0.25.0-beta.1";
const apkUrl = `https://github.com/wottyup/star-accounting/releases/download/${tag}/star-accounting-${tag}.apk`;
const configUrl = `https://raw.githubusercontent.com/wottyup/star-accounting/${tag}/app/version.json`;
const sourceUrl = `https://raw.githubusercontent.com/wottyup/star-accounting/${tag}/app/src/lib/stark/app-version.ts`;
const source = 'export const CURRENT_APP_VERSION_CODE = 239;\nexport const CURRENT_APP_VERSION_NAME = "0.25.0-beta.1";\n';
function release(extra = {}) {
  return { tag_name: tag, draft: false, body: "- 修复更新检查\n- 优化预算提示", assets: [
    { name: `star-accounting-${tag}.apk`, browser_download_url: apkUrl, state: "uploaded" },
    { name: "docker.tar.gz", browser_download_url: "https://example.invalid/docker.tar.gz", state: "uploaded" },
  ], ...extra };
}
function mockFetch(value = release(), versionSource = source) {
  return async (url) => {
    if (url === APP_UPDATE_URL) return Response.json(Array.isArray(value) ? value : [value]);
    if (url === configUrl) return new Response("not found", { status: 404 });
    assert.equal(url, sourceUrl);
    return new Response(versionSource);
  };
}

test("reads latest GitHub release and the same tag's Android version code", async () => {
  const controller = new AbortController();
  const requests = [];
  const request = mockFetch();
  const info = await fetchLatestAppVersion(controller.signal, async (url, options) => {
    requests.push(url);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.cache, "no-store");
    return request(url);
  });
  assert.deepEqual(requests, [APP_UPDATE_URL, configUrl, sourceUrl]);
  assert.deepEqual(info, { versionCode: 239, versionName: "0.25.0-beta.1", edition: "ktweb", apkUrl, changelog: "- 修复更新检查\n- 优化预算提示", forceUpdate: false });
  assert.equal(hasNewerAppVersion(238, info), true);
  assert.equal(hasNewerAppVersion(239, info), false);
  assert.equal(hasNewerAppVersion(240, info), false);
});

test("an older published version never downgrades the installed development build", async () => {
  const oldSource = source.replace("239", "196");
  const info = await fetchLatestAppVersion(undefined, mockFetch(release(), oldSource));
  assert.equal(info.versionCode, 196);
  assert.equal(hasNewerAppVersion(238, info), false);
});

test("drafts, invalid tags and malformed GitHub responses fail before reading version source", async () => {
  for (const value of [null, {}, release({ draft: true }), release({ tag_name: "main" }), release({ tag_name: "v0.25.0/../../main" }), release({ assets: null })]) {
    const requested = [];
    await assert.rejects(fetchLatestAppVersion(undefined, async (url) => {
      requested.push(url);
      return Response.json(Array.isArray(value) || value === null || Object.keys(value).length === 0 ? value : [value]);
    }), /发布/);
    assert.deepEqual(requested, [APP_UPDATE_URL]);
  }
});

test("missing, invalid or mismatched source versions never become an update", async () => {
  for (const versionSource of ["", source.replace("239", "0"), source.replace("239", "2.5"), source.replace("239", "9007199254740992"), source.replace("0.25.0-beta.1", "0.24.0-beta.1")]) {
    await assert.rejects(fetchLatestAppVersion(undefined, mockFetch(release(), versionSource)), /版本不一致/);
  }
});

test("missing APKs remain unavailable instead of using source archives or Docker packages", async () => {
  const info = await fetchLatestAppVersion(undefined, mockFetch(release({ assets: release().assets.slice(1) })));
  assert.equal(info.versionCode, 239);
  assert.equal(info.apkUrl, null);
  assert.equal(info.edition, "ktweb");
});

test("only the uploaded APK from this repository and exact release tag is eligible", async () => {
  const apk = release().assets[0];
  for (const assets of [
    [{ ...apk, name: "web-shell.apk" }],
    [{ ...apk, browser_download_url: apkUrl.replace("wottyup", "someone-else") }],
    [{ ...apk, browser_download_url: apkUrl.replace(tag + "/", "v0.24.0-beta.1/") }],
    [{ ...apk, browser_download_url: apkUrl.replace("https:", "http:") }],
    [{ ...apk, state: "open" }],
    [apk, apk],
  ]) {
    assert.equal((await fetchLatestAppVersion(undefined, mockFetch(release({ assets })))).apkUrl, null);
  }
});

test("API, version source and malformed JSON errors propagate as failed checks", async () => {
  await assert.rejects(fetchLatestAppVersion(undefined, async () => new Response("unavailable", { status: 503 })), /暂时不可用/);
  await assert.rejects(fetchLatestAppVersion(undefined, async (url) => url === APP_UPDATE_URL ? Response.json([release()]) : new Response("not found", { status: 404 })), /发布版本码/);
  await assert.rejects(fetchLatestAppVersion(undefined, async () => new Response("not JSON")), SyntaxError);
  await assert.rejects(fetchLatestAppVersion(undefined, async () => { throw new TypeError("Network unavailable"); }), /Network unavailable/);
});

test("cancellation is forwarded to both GitHub requests", async () => {
  for (const cancelOn of [APP_UPDATE_URL, configUrl, sourceUrl]) {
    const controller = new AbortController();
    const request = mockFetch();
    await assert.rejects(fetchLatestAppVersion(controller.signal, async (url, options) => {
      assert.equal(options.signal, controller.signal);
      if (url === cancelOn) controller.abort();
      options.signal.throwIfAborted();
      return request(url);
    }), { name: "AbortError" });
  }
});

function splitRelease(name, code, extra = {}) {
  const tag = `v${name}`;
  const url = `https://github.com/wottyup/star-accounting/releases/download/${tag}/star-accounting-${tag}.apk`;
  return {
    release: { tag_name: tag, draft: false, prerelease: name.includes("-beta."), published_at: "2026-11-19T00:00:00Z", body: name,
      assets: [{ name: `star-accounting-${tag}.apk`, browser_download_url: url, state: "uploaded" }], ...extra },
    config: { schemaVersion: 1, lastVersionCode: code,
      dev: { versionName: "0.25.4-dev.1", versionCode: code - 1 }, public: { versionName: name, versionCode: code } },
  };
}

test("new public beta metadata is independent of the internal 0.25 development version", async () => {
  const beta = splitRelease("0.10.0-beta.1", 244);
  const info = await fetchLatestAppVersion(undefined, async (url) => {
    if (url === APP_UPDATE_URL) return Response.json([beta.release]);
    assert.equal(url, "https://raw.githubusercontent.com/wottyup/star-accounting/v0.10.0-beta.1/app/version.json");
    return Response.json(beta.config);
  });
  assert.equal(info.versionName, "0.10.0-beta.1");
  assert.equal(hasNewerAppVersion(243, info), true);
});

test("beta and stable are compared by Android code; drafts and dev never become public updates", async () => {
  const beta = splitRelease("0.10.0-beta.2", 260);
  const stable = splitRelease("0.9.1", 196);
  const request = [];
  const info = await fetchLatestAppVersion(undefined, async (url) => {
    request.push(url);
    if (url === APP_UPDATE_URL) return Response.json([
      splitRelease("0.25.4-dev.2", 999).release,
      splitRelease("0.11.0-beta.1", 270, { draft: true }).release,
      stable.release, beta.release,
    ]);
    return Response.json(url.includes("v0.9.1/") ? stable.config : beta.config);
  });
  assert.equal(info.versionCode, 260);
  assert.equal(info.versionName, "0.10.0-beta.2");
  assert.equal(request.length, 3);
});

test("a complete public release survives a newer incomplete or invalid upload", async () => {
  const good = splitRelease("0.10.0-beta.1", 244);
  const missingApk = splitRelease("0.10.0-beta.2", 250, { assets: [] });
  const broken = splitRelease("0.10.0-beta.3", 251);
  const info = await fetchLatestAppVersion(undefined, async (url) => {
    if (url === APP_UPDATE_URL) return Response.json([broken.release, missingApk.release, good.release]);
    if (url.includes("beta.3/")) return Response.json({});
    return Response.json(url.includes("beta.2/") ? missingApk.config : good.config);
  });
  assert.equal(info.versionCode, 244);
});

test("malformed, stale or mismatched new metadata never falls back to legacy source", async () => {
  const beta = splitRelease("0.10.0-beta.1", 244);
  for (const config of [{}, { ...beta.config, lastVersionCode: 245, dev: { ...beta.config.dev, versionCode: 245 } },
    { ...beta.config, public: { ...beta.config.public, versionName: "0.10.0-beta.2" } }]) {
    const requests = [];
    await assert.rejects(fetchLatestAppVersion(undefined, async (url) => {
      requests.push(url);
      return Response.json(url === APP_UPDATE_URL ? [beta.release] : config);
    }));
    assert.equal(requests.length, 2);
  }
});
