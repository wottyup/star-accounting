import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { advanceVersion, readVersions, reserveBuildVersion } from "./version.mjs";
import { buildVersion, nextVersion, reserveVersion, validateRelease, validateVersionConfig } from "../src/lib/stark/version-policy.ts";

const fixture = () => ({ schemaVersion: 1, lastVersionCode: 244,
  dev: { versionName: "0.25.4-dev.1", versionCode: 243 },
  public: { versionName: "0.10.0-beta.1", versionCode: 244 } });

test("dev and beta advance independently and share a monotonically increasing Android code", () => {
  const initial = fixture();
  const dev = nextVersion(initial, "dev");
  assert.deepEqual(dev.dev, { versionName: "0.25.4-dev.2", versionCode: 245 });
  assert.deepEqual(dev.public, initial.public);
  assert.throws(() => buildVersion(dev, "beta"), /落后/);
  const beta = nextVersion(dev, "beta");
  assert.deepEqual(beta.public, { versionName: "0.10.0-beta.2", versionCode: 246 });
  assert.deepEqual(beta.dev, dev.dev);
  assert.equal(buildVersion(beta, "beta").versionCode, 246);
  assert.deepEqual(initial, fixture());
});

test("a new target resets phase sequence; minor resets patch; stable removes the beta suffix", () => {
  const minor = nextVersion(fixture(), "dev", "minor");
  assert.equal(minor.dev.versionName, "0.26.0-dev.1");
  assert.equal(nextVersion(minor, "dev", "patch").dev.versionName, "0.26.1-dev.1");
  assert.equal(nextVersion(fixture(), "beta", "0.11.0").public.versionName, "0.11.0-beta.1");
  const stable = nextVersion(fixture(), "stable");
  assert.equal(stable.public.versionName, "0.10.0");
  assert.throws(() => nextVersion(stable, "beta"), /更高目标/);
  assert.equal(nextVersion(stable, "beta", "minor").public.versionName, "0.11.0-beta.1");
  assert.throws(() => nextVersion(stable, "stable"), /更高目标/);
  assert.equal(nextVersion(stable, "stable", "patch").public.versionName, "0.10.1");
});

test("internal builds never force a beta sequence change when refreshing its Android code", () => {
  const dev = nextVersion(nextVersion(fixture(), "dev"), "dev");
  const beta = reserveVersion(dev, "beta");
  assert.deepEqual(beta.dev, dev.dev);
  assert.equal(beta.public.versionName, "0.10.0-beta.1");
  assert.equal(beta.public.versionCode, 247);
  assert.equal(buildVersion(beta, "beta").versionCode, 247);
  assert.deepEqual(reserveVersion(beta, "beta"), beta);
  assert.throws(() => reserveVersion(dev, "stable"), /渠道/);
  assert.throws(() => reserveVersion(dev, "nightly"), /未知/);
});

test("invalid targets, downgrades and exhausted Android codes are rejected", () => {
  for (const target of ["0.9.9", "v0.11.0", "0.11.0-beta.1", "0.11", "01.1.0", "0.9007199254740992.0"]) {
    assert.throws(() => nextVersion(fixture(), "beta", target));
  }
  assert.throws(() => nextVersion(fixture(), "nightly"));
  const exhausted = { ...fixture(), lastVersionCode: 2100000000,
    public: { ...fixture().public, versionCode: 2100000000 } };
  assert.throws(() => nextVersion(exhausted, "dev"), /配置无效/);
  for (const config of [null, {}, { ...fixture(), lastVersionCode: 243 },
    { ...fixture(), dev: { versionName: "0.10.0-beta.1", versionCode: 243 } }]) assert.throws(() => validateVersionConfig(config));
});

test("public release validation uses the independent public name, latest code and matching notes", () => {
  const config = fixture();
  const notes = "## [0.10.0-beta.1]\n\n- 新增识图记账。\n\n## [0.9.1]\n- 历史版本。\n";
  assert.deepEqual(validateRelease(config, "v0.10.0-beta.1", notes), {
    ...config.public, channel: "beta", tag: "v0.10.0-beta.1", apkName: "star-accounting-v0.10.0-beta.1.apk",
  });
  assert.throws(() => validateRelease(config, "v0.25.4-dev.1", notes), /标签/);
  assert.throws(() => validateRelease(config, "v0.10.0-beta.1", "## [Unreleased]\n- 不属于该版本。\n"), /摘要/);
  assert.throws(() => buildVersion(config, "stable"), /渠道/);
  assert.throws(() => buildVersion(config, "unknown"), /未知/);
});

test("file automation preserves the other channel and invalid operations leave all files untouched", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "star-version-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const configPath = join(directory, "version.json");
  const packagePath = join(directory, "package.json");
  writeFileSync(configPath, JSON.stringify(fixture()));
  writeFileSync(packagePath, JSON.stringify({ name: "test-app", version: fixture().dev.versionName }));
  for (const [channel, target] of [["beta", "0.9.0"], ["bad", undefined]]) {
    const before = [readFileSync(configPath, "utf8"), readFileSync(packagePath, "utf8")];
    assert.throws(() => advanceVersion(channel, target, directory));
    assert.deepEqual([readFileSync(configPath, "utf8"), readFileSync(packagePath, "utf8")], before);
    assert.equal(existsSync(join(directory, ".version.lock")), false);
  }
  advanceVersion("dev", undefined, directory);
  assert.equal(readVersions(directory).dev.versionName, "0.25.4-dev.2");
  assert.equal(JSON.parse(readFileSync(packagePath)).version, "0.25.4-dev.2");
  advanceVersion("beta", undefined, directory);
  assert.equal(readVersions(directory).public.versionCode, 246);
  assert.equal(JSON.parse(readFileSync(packagePath)).version, "0.25.4-dev.2");
  writeFileSync(join(directory, ".build.lock"), "other builder");
  assert.throws(() => advanceVersion("beta", undefined, directory), /构建正在进行/);
  assert.equal(readVersions(directory).public.versionCode, 246);
  rmSync(join(directory, ".build.lock"));
  advanceVersion("dev", undefined, directory);
  reserveBuildVersion("beta", directory);
  assert.equal(readVersions(directory).public.versionCode, 248);
  assert.equal(readVersions(directory).public.versionName, "0.10.0-beta.2");
  writeFileSync(join(directory, ".version.lock"), "other process");
  assert.throws(() => advanceVersion("dev", undefined, directory), { code: "EEXIST" });
  assert.equal(readFileSync(join(directory, ".version.lock"), "utf8"), "other process");
});
