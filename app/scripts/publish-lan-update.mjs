import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(appDir, "..");
const hash = (data) => createHash("sha256").update(data).digest("hex");

function isLanManifest(url) {
  const [a, b] = url.hostname.split(".").map(Number);
  return url.protocol === "http:" && isIP(url.hostname) === 4
    && (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31)
    && (!url.port || Number(url.port) > 0)
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/version.json";
}

export function changelogForVersion(history, versionName) {
  const lines = history.split(/\r?\n/);
  const start = lines.indexOf(`## ${versionName}`);
  const items = [];
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith("## ")) break;
      if (line.startsWith("- ")) items.push(line.slice(2).trim());
    }
  }
  if (!items.length) throw new Error(`版本历史缺少 ${versionName} 的更新摘要。`);
  items.push("如下载并安装失败，请点击下方“下载更新”用浏览器下载安装。");
  return items.join("\n");
}

/** Called only after a successful build; the manifest becomes visible last. */
export function publishLanUpdate({ archivePath, outputDirectory, manifestUrl, versionCode, versionName, edition, changelog }) {
  const url = new URL(manifestUrl);
  if (!isLanManifest(url)) throw new Error("本机发布仅支持私有 IPv4 的 HTTP /version.json 地址。");
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || !versionName || edition !== "ktweb") {
    throw new Error("安装包版本或类型无效。");
  }
  const data = readFileSync(archivePath);
  if (!data.length) throw new Error("安装包为空，保留原更新信息。");
  const sha256 = hash(data);
  mkdirSync(outputDirectory, { recursive: true });
  const lock = join(outputDirectory, ".publish.lock");
  // Concurrent builds must not let an older version overwrite a newer feed.
  writeFileSync(lock, String(process.pid), { flag: "wx" });
  let pending;
  try {
    const manifest = join(outputDirectory, "version.json");
    const previousText = existsSync(manifest) ? readFileSync(manifest, "utf8") : null;
    const previous = previousText === null ? null : JSON.parse(previousText);
    if (previous && (!Number.isSafeInteger(previous.versionCode) || previous.edition !== edition)) {
      throw new Error("现有更新清单无效或属于其他 App 类型，未替换。");
    }
    if (previous && previous.versionCode > versionCode) throw new Error("安装包版本低于已发布版本，未回退更新信息。");

    const target = join(outputDirectory, basename(archivePath));
    if (existsSync(target)) {
      if (hash(readFileSync(target)) !== sha256) throw new Error("同名安装包内容不同，拒绝覆盖历史包。");
    } else {
      copyFileSync(archivePath, target, constants.COPYFILE_EXCL);
      if (hash(readFileSync(target)) !== sha256) throw new Error("安装包复制校验失败，未切换更新信息。");
    }
    const info = {
      versionCode, versionName, edition,
      apkUrl: new URL(encodeURIComponent(basename(target)), url).href,
      changelog, forceUpdate: false,
    };
    if (previous && Object.keys(info).every((key) => info[key] === previous[key])) {
      return { info, sha256, changed: false };
    }
    if (previousText !== null) {
      const backup = join(outputDirectory, `version-c${previous.versionCode}-${Date.now()}-${randomUUID()}.json`);
      writeFileSync(backup, previousText, { flag: "wx" });
    }
    pending = join(outputDirectory, `.version-${randomUUID()}.tmp`);
    writeFileSync(pending, `${JSON.stringify(info, null, 2)}\n`, { flag: "wx" });
    renameSync(pending, manifest);
    return { info, sha256, changed: true };
  } finally {
    if (pending) rmSync(pending, { force: true });
    rmSync(lock, { force: true });
  }
}

function aaptPath() {
  const localProperties = join(appDir, "android/local.properties");
  const configuredSdk = existsSync(localProperties)
    ? readFileSync(localProperties, "utf8").match(/^\s*sdk\.dir\s*=\s*(.+?)\s*$/m)?.[1].replace(/\\([\\:= ])/g, "$1")
    : null;
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || configuredSdk || "/opt/android-sdk";
  const tools = join(sdk, "build-tools");
  if (existsSync(tools)) {
    for (const version of readdirSync(tools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      const file = join(tools, version, process.platform === "win32" ? "aapt.exe" : "aapt");
      if (existsSync(file)) return file;
    }
  }
  return "aapt";
}

function main() {
  if (process.env.CI && process.env.CI !== "false" && process.env.CI !== "0") {
    console.log("[lan-update] CI 构建跳过本机更新发布。");
    return;
  }
  const versionSource = readFileSync(join(appDir, "src/lib/stark/app-version.ts"), "utf8");
  const manifestUrl = versionSource.match(/APP_UPDATE_URL\s*=\s*["']([^"']+)["']/)?.[1];
  if (!manifestUrl) throw new Error("找不到 App 检测更新地址。");
  if (new URL(manifestUrl).protocol === "https:") {
    console.log("[lan-update] 当前检测地址为官网，跳过本机更新发布。");
    return;
  }
  const metadataDir = join(appDir, "android/app/build/outputs/apk/ktweb/debug");
  const metadata = JSON.parse(readFileSync(join(metadataDir, "output-metadata.json"), "utf8"));
  if (metadata.applicationId !== "com.wotty.stark.ktweb" || metadata.variantName !== "ktwebDebug" || metadata.elements?.length !== 1) {
    throw new Error("构建产物不是单一 KT 混合版 Debug APK。");
  }
  const { versionCode, versionName, outputFile } = metadata.elements[0];
  const sourceCode = Number(versionSource.match(/CURRENT_APP_VERSION_CODE\s*=\s*(\d+)/)?.[1]);
  const sourceName = versionSource.match(/CURRENT_APP_VERSION_NAME\s*=\s*["']([^"']+)["']/)?.[1];
  if (versionCode !== sourceCode || versionName !== sourceName || JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")).version !== versionName) {
    throw new Error("APK、前端与 package.json 版本不一致，未发布。");
  }
  const builtApk = join(metadataDir, outputFile);
  const badging = execFileSync(aaptPath(), ["dump", "badging", builtApk], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  const identity = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
  if (!identity || identity[1] !== metadata.applicationId || Number(identity[2]) !== versionCode || identity[3] !== versionName) {
    throw new Error("APK 实际版本与构建元数据不一致，未发布。");
  }
  const builtHash = hash(readFileSync(builtApk));
  const releases = join(repoDir, "releases");
  const prefix = `wotty-stark-ktweb-debug-v${versionName}-c${versionCode}-`;
  const archive = readdirSync(releases).filter((name) => name.startsWith(prefix) && name.endsWith(".apk")).sort().reverse()
    .find((name) => hash(readFileSync(join(releases, name))) === builtHash);
  if (!archive) throw new Error("找不到与本次 APK 内容一致的历史归档，未发布。");
  const result = publishLanUpdate({
    archivePath: join(releases, archive), outputDirectory: join(releases, "lan-update-test"), manifestUrl,
    versionCode, versionName, edition: "ktweb",
    changelog: changelogForVersion(readFileSync(join(repoDir, "docs/version-history.md"), "utf8"), versionName),
  });
  console.log(`[lan-update] ${result.changed ? "已自动发布" : "已同步"} ${versionName} (${versionCode})`);
  console.log(`[lan-update] 检测地址：${manifestUrl}`);
  console.log(`[lan-update] 安装包：${result.info.apkUrl}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`[lan-update] 发布失败：${error.message}`);
    process.exitCode = 1;
  }
}
