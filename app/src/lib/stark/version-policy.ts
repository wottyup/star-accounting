export type BuildChannel = "dev" | "beta" | "stable";
export type VersionRecord = { versionName: string; versionCode: number };
export type VersionConfig = {
  schemaVersion: number;
  lastVersionCode: number;
  dev: VersionRecord;
  public: VersionRecord;
};

const basePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const publicPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/;
const devPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-dev\.([1-9]\d*)$/;
const validCode = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2100000000;
const validName = (value: unknown, pattern: RegExp) => typeof value === "string" && pattern.test(value)
  && value.split(/\D+/).filter(Boolean).every((part) => Number.isSafeInteger(Number(part)));

export function validateVersionConfig(value: unknown): asserts value is VersionConfig {
  const config = value as VersionConfig | null;
  if (!config || config.schemaVersion !== 1 || !validCode(config.lastVersionCode)
    || !config.dev || !config.public || !validName(config.dev.versionName, devPattern)
    || !validName(config.public.versionName, publicPattern)
    || !validCode(config.dev.versionCode) || !validCode(config.public.versionCode)
    || config.dev.versionCode === config.public.versionCode
    || Math.max(config.dev.versionCode, config.public.versionCode) !== config.lastVersionCode) {
    throw new Error("版本配置无效：两条版本线必须独立，Android versionCode 必须为统一分配的正整数。");
  }
}

export function buildVersion(config: VersionConfig, channel: string = "dev"): VersionRecord {
  validateVersionConfig(config);
  if (channel === "dev") return config.dev;
  if (channel !== "beta" && channel !== "stable") throw new Error(`未知构建渠道：${channel}`);
  if ((channel === "beta") !== config.public.versionName.includes("-beta.")) throw new Error("公开版本与构建渠道不一致。");
  if (config.public.versionCode !== config.lastVersionCode) throw new Error("公开版本码已落后于内部包，请先运行 pnpm version:reserve beta（或 stable），只更新版本码。");
  return config.public;
}

export function reserveVersion(config: VersionConfig, channel: string): VersionConfig {
  validateVersionConfig(config);
  if (!["dev", "beta", "stable"].includes(channel)) throw new Error(`未知构建渠道：${channel}`);
  const key = channel === "dev" ? "dev" : "public";
  if (channel !== "dev" && (channel === "beta") !== config.public.versionName.includes("-beta.")) throw new Error("公开版本与构建渠道不一致。");
  if (config[key].versionCode === config.lastVersionCode) return config;
  const result = { ...config, lastVersionCode: config.lastVersionCode + 1,
    [key]: { ...config[key], versionCode: config.lastVersionCode + 1 } };
  validateVersionConfig(result);
  return result;
}

export function nextVersion(config: VersionConfig, channel: string, target?: string): VersionConfig {
  validateVersionConfig(config);
  if (!["dev", "beta", "stable"].includes(channel)) throw new Error(`未知构建渠道：${channel}`);
  const key = channel === "dev" ? "dev" : "public";
  const current = config[key].versionName;
  const [base, suffix] = current.split("-");
  let nextBase = base;
  if (target === "patch" || target === "minor") {
    const [major, minor, patch] = base.split(".").map(Number);
    nextBase = target === "patch" ? `${major}.${minor}.${patch + 1}` : `${major}.${minor + 1}.0`;
  } else if (target) {
    if (!validName(target, basePattern)) throw new Error("目标版本必须是 x.y.z、patch 或 minor。");
    nextBase = target;
  }
  const oldParts = base.split(".").map(Number);
  const nextParts = nextBase.split(".").map(Number);
  const difference = nextParts.map((part, i) => part - oldParts[i]).find((part) => part !== 0) ?? 0;
  if (difference < 0) throw new Error("同一版本线不允许回退目标版本。");
  if (channel === "beta" && !suffix && difference === 0) {
    throw new Error("正式版之后的 beta 必须指定更高目标版本，例如 pnpm version:next beta minor。");
  }
  if (channel === "stable" && !suffix && difference === 0) throw new Error("请为下一个正式版指定更高目标版本。");
  const sequence = nextBase === base && suffix?.startsWith(`${channel}.`) ? Number(suffix.split(".")[1]) + 1 : 1;
  const versionName = channel === "stable" ? nextBase : `${nextBase}-${channel}.${sequence}`;
  const result = { ...config, lastVersionCode: config.lastVersionCode + 1,
    [key]: { versionName, versionCode: config.lastVersionCode + 1 } };
  validateVersionConfig(result);
  return result;
}

export function validateRelease(config: VersionConfig, tag: string, changelog: string) {
  const channel = config.public.versionName.includes("-beta.") ? "beta" : "stable";
  const version = buildVersion(config, channel);
  if (tag !== `v${version.versionName}`) throw new Error("发布标签与公开版本配置不一致。");
  const heading = `## [${version.versionName}]`;
  const section = changelog.split(heading + "\n")[1]?.split(/^## /m)[0];
  if (!section || !/^(?:- |新增：|修改：)\S.*$/m.test(section)) throw new Error(`CHANGELOG.md 缺少 ${heading} 的发布摘要。`);
  return { ...version, channel, tag, apkName: `star-accounting-v${version.versionName}.apk` };
}
