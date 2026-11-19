import assert from "node:assert/strict";
import test from "node:test";
import { APP_UPDATE_URL, downloadAppUpdate, hasNewerAppVersion } from "./app-version.ts";

test("compares APK versions by version code instead of version name text", () => {
  assert.equal(hasNewerAppVersion(84, { versionCode: 85, versionName: "0.0.85" }), true);
  assert.equal(hasNewerAppVersion(84, { versionCode: 84, versionName: "9.9.9" }), false);
  assert.equal(hasNewerAppVersion(84, { versionCode: 83, versionName: "0.0.83" }), false);
});

test("uses the StarAccounting GitHub public release list API", () => {
  assert.equal(APP_UPDATE_URL, "https://api.github.com/repos/wottyup/star-accounting/releases?per_page=100");
});

const lanManifestUrl = "http://10.126.126.3:18767/version.json";
const lanUpdate = {
  versionCode: 224,
  versionName: "0.20.7-dev.1",
  edition: "ktweb",
  apkUrl: "http://10.126.126.3:18767/current-test.apk",
};

test("authorizes the LAN origin through the native manifest method before starting a download", async () => {
  const calls = [];
  const result = await downloadAppUpdate(lanManifestUrl, lanUpdate, {
    async getLanUpdateManifest(options) {
      calls.push(["manifest", options]);
      return lanUpdate;
    },
    async downloadAndInstall(options) {
      assert.equal(calls.length, 1);
      calls.push(["download", options]);
      return { installationStarted: true };
    },
  });
  assert.deepEqual(calls, [
    ["manifest", { url: lanManifestUrl }],
    ["download", { url: lanUpdate.apkUrl, versionCode: 224 }],
  ]);
  assert.equal(result.installationStarted, true);
});

test("does not start downloading if native LAN validation fails", async () => {
  await assert.rejects(downloadAppUpdate(lanManifestUrl, lanUpdate, {
    async getLanUpdateManifest() { throw new Error("Cannot validate LAN manifest"); },
    async downloadAndInstall() { assert.fail("Must not download an unapproved source"); },
  }), /Cannot validate LAN manifest/);
});

test("requires a fresh check if the published version, APK URL or edition changes", async () => {
  for (const changes of [{ versionCode: 225 }, { apkUrl: lanUpdate.apkUrl + "-changed" }, { edition: "web" }]) {
    await assert.rejects(downloadAppUpdate(lanManifestUrl, lanUpdate, {
      async getLanUpdateManifest() { return { ...lanUpdate, ...changes }; },
      async downloadAndInstall() { assert.fail("Must not download changed update metadata"); },
    }), /版本信息已变化/);
  }
});

test("GitHub APK updates continue through the existing native HTTPS download path", async () => {
  const info = { ...lanUpdate, apkUrl: "https://github.com/wottyup/star-accounting/releases/download/v0.20.7-dev.1/star-accounting-v0.20.7-dev.1.apk" };
  await downloadAppUpdate(APP_UPDATE_URL, info, {
    async getLanUpdateManifest() { assert.fail("HTTPS is not a LAN HTTP source"); },
    async downloadAndInstall(options) {
      assert.deepEqual(options, { url: info.apkUrl, versionCode: 224 });
      return { installationStarted: true };
    },
  });
});
