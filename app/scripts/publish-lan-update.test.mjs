import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { changelogForVersion, publishLanUpdate } from "./publish-lan-update.mjs";
import { hasNewerAppVersion } from "../src/lib/stark/app-version.ts";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "star-update-publish-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outputDirectory = join(root, "feed");
  const archive = (name, data = "completed APK contents") => {
    const file = join(root, name);
    writeFileSync(file, data);
    return file;
  };
  const options = {
    archivePath: archive("star-v0.20.7-dev.2-c225.apk"), outputDirectory,
    manifestUrl: "http://10.126.126.3:18767/version.json",
    versionCode: 225, versionName: "0.20.7-dev.2", edition: "ktweb", changelog: "修复更新。",
  };
  const manifest = join(outputDirectory, "version.json");
  return { options, archive, manifest, read: () => JSON.parse(readFileSync(manifest, "utf8")) };
}

test("publishes a completed package and its own version through the fixed feed", (t) => {
  const f = fixture(t);
  const result = publishLanUpdate(f.options);
  assert.equal(result.changed, true);
  assert.deepEqual(f.read(), {
    versionCode: 225, versionName: "0.20.7-dev.2", edition: "ktweb",
    apkUrl: "http://10.126.126.3:18767/star-v0.20.7-dev.2-c225.apk",
    changelog: "修复更新。", forceUpdate: false,
  });
  assert.deepEqual(readFileSync(join(f.options.outputDirectory, "star-v0.20.7-dev.2-c225.apk")), readFileSync(f.options.archivePath));
  assert.equal(hasNewerAppVersion(224, f.read()), true);
  assert.equal(existsSync(join(f.options.outputDirectory, ".publish.lock")), false);
});

test("a newer build automatically changes the link and preserves the old APK and manifest", (t) => {
  const f = fixture(t);
  const old = { ...f.options, archivePath: f.archive("old-c224.apk", "older package"), versionCode: 224, versionName: "0.20.7-dev.1" };
  publishLanUpdate(old);
  const previous = readFileSync(f.manifest, "utf8");
  publishLanUpdate(f.options);
  assert.equal(f.read().versionCode, 225);
  assert.ok(f.read().apkUrl.endsWith("/star-v0.20.7-dev.2-c225.apk"));
  assert.equal(readFileSync(join(f.options.outputDirectory, "old-c224.apk"), "utf8"), "older package");
  const backups = readdirSync(f.options.outputDirectory).filter((name) => name.startsWith("version-c224-"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(f.options.outputDirectory, backups[0]), "utf8"), previous);
});

test("repeated publication is idempotent and a same-version rebuild does not pretend to be an upgrade", (t) => {
  const f = fixture(t);
  publishLanUpdate(f.options);
  assert.equal(publishLanUpdate(f.options).changed, false);
  assert.equal(readdirSync(f.options.outputDirectory).filter((name) => name.startsWith("version-c")).length, 0);
  publishLanUpdate({ ...f.options, archivePath: f.archive("same-version-new-build.apk", "new build bytes") });
  assert.equal(hasNewerAppVersion(225, f.read()), false);
  assert.equal(f.read().versionCode, 225);
});

test("an older build cannot roll back the feed", (t) => {
  const f = fixture(t);
  publishLanUpdate(f.options);
  const previous = readFileSync(f.manifest, "utf8");
  assert.throws(() => publishLanUpdate({ ...f.options, versionCode: 224 }), /低于已发布版本/);
  assert.equal(readFileSync(f.manifest, "utf8"), previous);
  assert.equal(existsSync(join(f.options.outputDirectory, ".publish.lock")), false);
});

test("missing or empty build artifacts leave the working feed unchanged", (t) => {
  const f = fixture(t);
  publishLanUpdate(f.options);
  const previous = readFileSync(f.manifest, "utf8");
  for (const archivePath of [join(f.options.outputDirectory, "missing.apk"), f.archive("empty.apk", "")]) {
    assert.throws(() => publishLanUpdate({ ...f.options, archivePath }));
    assert.equal(readFileSync(f.manifest, "utf8"), previous);
  }
});

test("never overwrites an existing APK with different contents under the same filename", (t) => {
  const f = fixture(t);
  publishLanUpdate(f.options);
  const previous = readFileSync(f.manifest, "utf8");
  writeFileSync(f.options.archivePath, "changed source contents");
  assert.throws(() => publishLanUpdate(f.options), /拒绝覆盖历史包/);
  assert.equal(readFileSync(f.manifest, "utf8"), previous);
  assert.equal(readFileSync(join(f.options.outputDirectory, "star-v0.20.7-dev.2-c225.apk"), "utf8"), "completed APK contents");
});

test("does not replace another edition's feed or a malformed manifest", (t) => {
  const f = fixture(t);
  publishLanUpdate(f.options);
  for (const previous of [JSON.stringify({ ...f.read(), edition: "web" }), "incomplete json {"]) {
    writeFileSync(f.manifest, previous);
    assert.throws(() => publishLanUpdate(f.options));
    assert.equal(readFileSync(f.manifest, "utf8"), previous);
    assert.equal(existsSync(join(f.options.outputDirectory, ".publish.lock")), false);
  }
});

test("refuses a concurrent publisher without removing its lock", (t) => {
  const f = fixture(t);
  publishLanUpdate(f.options);
  const lock = join(f.options.outputDirectory, ".publish.lock");
  writeFileSync(lock, "another publisher");
  assert.throws(() => publishLanUpdate(f.options), { code: "EEXIST" });
  assert.equal(readFileSync(lock, "utf8"), "another publisher");
});

test("only builds LAN URLs and extracts the selected version's notes with a download fallback", (t) => {
  const f = fixture(t);
  for (const manifestUrl of ["https://s.wotty.app/version.json", "http://8.8.8.8/version.json", "http://10.126.126.3/wrong.json", "http://10.126.126.3:0/version.json"]) {
    assert.throws(() => publishLanUpdate({ ...f.options, manifestUrl }), /私有 IPv4/);
  }
  const history = "## 0.20.7-dev.2\n\n- 自动发布。\n\n## 0.20.7-dev.1\n\n- 上一版修复。\n";
  assert.equal(changelogForVersion(history, "0.20.7-dev.2"), "自动发布。\n如下载并安装失败，请点击下方“下载更新”用浏览器下载安装。");
  assert.throws(() => changelogForVersion(history, "0.0.1"), /缺少/);
});

test("the CLI skips LAN publication on CI", () => {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL("./publish-lan-update.mjs", import.meta.url))], {
    env: { ...process.env, CI: "true" }, encoding: "utf8",
  });
  assert.match(output, /CI 构建跳过本机更新发布/);
});
