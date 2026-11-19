import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { advanceVersion, appDir, readVersions, reserveBuildVersion } from "./version.mjs";
import { buildVersion } from "../src/lib/stark/version-policy.ts";

const require = createRequire(import.meta.url);

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" && command.endsWith(".bat") });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 构建失败（${result.status ?? result.signal}）。`);
}

export function build(command, channel, edition = "ktweb") {
  if (!["web", "apk"].includes(command) || !["dev", "beta", "stable"].includes(channel)
    || !["web", "ktweb"].includes(edition)) throw new Error("用法：build.mjs web|apk dev|beta|stable [web|ktweb]");
  const lock = join(appDir, ".build.lock");
  writeFileSync(lock, String(process.pid), { flag: "wx" });
  try {
    // Each new internal APK gets a new dev sequence and a globally increasing code.
    // A public build refreshes a stale code without consuming another beta name.
    const config = command !== "apk" ? readVersions()
      : channel === "dev" ? advanceVersion("dev", undefined, appDir, { insideBuild: true })
      : reserveBuildVersion(channel, appDir, { insideBuild: true });
    const version = buildVersion(config, channel);
    const metadata = { ...version, channel };
    const env = { ...process.env, STARK_BUILD_CHANNEL: channel };
    console.log(`[build] ${channel}: ${version.versionName} (Android ${version.versionCode})`);
    run(process.execPath, [require.resolve("next/dist/bin/next"), "build"], appDir, env);
    // This file travels with the exported web assets and is checked by Gradle.
    writeFileSync(join(appDir, "out/build-version.json"), JSON.stringify(metadata, null, 2) + "\n");
    if (command === "web") return metadata;
    run(process.execPath, [join(appDir, "scripts/sync-android.mjs")], appDir, env);
    const androidDir = join(appDir, "android");
    const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (process.platform === "win32" ? undefined : "/opt/android-sdk");
    if (sdk) { env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk; }
    env.GRADLE_OPTS ||= "-Dorg.gradle.jvmargs=-Xmx1280m -Dfile.encoding=UTF-8";
    const task = `assemble${edition === "web" ? "Web" : "Ktweb"}Debug`;
    run(process.platform === "win32" ? join(androidDir, "gradlew.bat") : "bash",
      [...(process.platform === "win32" ? [] : ["./gradlew"]), "--no-daemon", "--max-workers=1", task], androidDir, env);
    const outputDir = join(androidDir, `app/build/outputs/apk/${edition}/debug`);
    const output = JSON.parse(readFileSync(join(outputDir, "output-metadata.json"), "utf8"));
    if (output.applicationId !== `com.wotty.stark.${edition}` || output.elements?.length !== 1 || output.elements[0].versionName !== version.versionName
      || output.elements[0].versionCode !== version.versionCode) throw new Error("APK 与前端版本不同步。");
    if (edition === "ktweb") run(process.execPath, [join(appDir, "scripts/publish-lan-update.mjs")], appDir, env);
    console.log(`[build] 历史包已保存在 releases/，本次未上传。`);
    return metadata;
  } finally { rmSync(lock, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command = "web", channel = process.env.STARK_BUILD_CHANNEL || "dev", edition, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error("构建命令参数过多。");
    build(command, channel, edition);
  } catch (error) { console.error(`[build] ${error.message}`); process.exitCode = 1; }
}
