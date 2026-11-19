import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVersion, nextVersion, reserveVersion, validateRelease, validateVersionConfig } from "../src/lib/stark/version-policy.ts";
import { fetchLatestAppVersion } from "../src/lib/stark/app-version.ts";

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function readVersions(directory = appDir) {
  const config = JSON.parse(readFileSync(join(directory, "version.json"), "utf8"));
  validateVersionConfig(config);
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (pkg.version !== config.dev.versionName) throw new Error("package.json 与内部版本不同步，请运行 pnpm version:sync。");
  return config;
}

function updateVersions(directory, transform, { insideBuild = false } = {}) {
  if (!insideBuild && existsSync(join(directory, ".build.lock"))) throw new Error("构建正在进行，请完成后再调整版本。");
  const lock = join(directory, ".version.lock");
  writeFileSync(lock, String(process.pid), { flag: "wx" });
  try {
    const config = transform(readVersions(directory));
    const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    pkg.version = config.dev.versionName;
    // Validate everything before either tracked file changes. The lock excludes other builders.
    writeFileSync(join(directory, "version.json.tmp"), JSON.stringify(config, null, 2) + "\n");
    writeFileSync(join(directory, "package.json.tmp"), JSON.stringify(pkg, null, 2) + "\n");
    renameSync(join(directory, "version.json.tmp"), join(directory, "version.json"));
    renameSync(join(directory, "package.json.tmp"), join(directory, "package.json"));
    return config;
  } finally {
    rmSync(lock, { force: true });
    rmSync(join(directory, "version.json.tmp"), { force: true });
    rmSync(join(directory, "package.json.tmp"), { force: true });
  }
}

export function advanceVersion(channel, target, directory = appDir, options = {}) {
  return updateVersions(directory, (config) => nextVersion(config, channel, target), options);
}

export function reserveBuildVersion(channel, directory = appDir, options = {}) {
  return updateVersions(directory, (config) => reserveVersion(config, channel), options);
}

async function main() {
  const [command = "status", channel, target, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("版本命令参数过多。");
  if (command === "next") return advanceVersion(channel, target);
  if (command === "reserve") {
    if (target) throw new Error("重新预留版本码不接受目标版本，修改版本名称请用 version:next。");
    return reserveBuildVersion(channel);
  }
  if (command === "sync") {
    if (existsSync(join(appDir, ".build.lock")) || existsSync(join(appDir, ".version.lock"))) throw new Error("构建或版本调整正在进行，暂不覆盖 package.json。");
    const config = JSON.parse(readFileSync(join(appDir, "version.json"), "utf8"));
    validateVersionConfig(config);
    const file = join(appDir, "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...pkg, version: config.dev.versionName }, null, 2) + "\n");
    return config;
  }
  const config = readVersions();
  if (command === "status") return config;
  if (command === "build") return buildVersion(config, channel);
  if (command === "check-release" || command === "check-release-github") {
    const release = validateRelease(config, channel, readFileSync(join(appDir, "../CHANGELOG.md"), "utf8"));
    if (command === "check-release-github") {
      const previous = await fetchLatestAppVersion(AbortSignal.timeout(30000));
      if (release.versionCode <= previous.versionCode) throw new Error("公开版本码未超过 GitHub 已发布版本，拒绝发布。");
    }
    return release;
  }
  throw new Error(`未知版本命令：${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(), null, 2)); }
  catch (error) { console.error(`[version] ${error.message}`); process.exitCode = 1; }
}
