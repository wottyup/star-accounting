import versionConfig from "../../../version.json" with { type: "json" };
import { validateVersionConfig } from "./version-policy.ts";

// Next freezes these values into the bundle for the selected build channel.
// Direct Node tests and tools fall back to the internal source version.
export const CURRENT_APP_VERSION_CODE = Number(process.env.NEXT_PUBLIC_STARK_VERSION_CODE || versionConfig.dev.versionCode);
export const CURRENT_APP_VERSION_NAME = process.env.NEXT_PUBLIC_STARK_VERSION_NAME || versionConfig.dev.versionName;
export const APP_UPDATE_URL = "https://api.github.com/repos/wottyup/star-accounting/releases?per_page=100";

export type AppVersionInfo = {
  versionCode: number;
  versionName: string;
  apkUrl?: string | null;
  changelog?: string | null;
  forceUpdate?: boolean;
  edition?: "web" | "ktweb";
};

export function hasNewerAppVersion(currentVersionCode: number, latest: AppVersionInfo) {
  return Number.isFinite(latest.versionCode) && latest.versionCode > currentVersionCode;
}

/** Both public beta and stable releases participate; internal dev tags never do. */
export async function fetchLatestAppVersion(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<AppVersionInfo> {
  const response = await fetcher(APP_UPDATE_URL, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error("GitHub 版本服务暂时不可用。");
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error("GitHub 发布信息无效。");
  const releases = value.filter((item): item is Record<string, unknown> => {
    if (!item || typeof item !== "object") return false;
    const release = item as Record<string, unknown>;
    return release.draft === false && typeof release.tag_name === "string"
      && /^v\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(release.tag_name)
      && Array.isArray(release.assets);
  }).sort((a, b) => Date.parse(String(b.published_at)) - Date.parse(String(a.published_at))).slice(0, 10);
  if (!releases.length) throw new Error("GitHub 暂无有效的公开发布版本。");
  const results = await Promise.allSettled(releases.map((release) => readReleaseVersion(release, signal, fetcher)));
  if (signal?.aborted) signal.throwIfAborted();
  const versions = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!versions.length) {
    const failure = results.find((result) => result.status === "rejected");
    throw failure?.reason ?? new Error("无法读取 GitHub 发布版本码。");
  }
  // Prefer usable packages; an incomplete upload must not hide a valid release.
  return versions.sort((a, b) => Number(Boolean(b.apkUrl)) - Number(Boolean(a.apkUrl)) || b.versionCode - a.versionCode)[0];
}

async function readReleaseVersion(release: Record<string, unknown>, signal: AbortSignal | undefined, fetcher: typeof fetch): Promise<AppVersionInfo> {
  const tag = release.tag_name as string;
  const tagRoot = `https://raw.githubusercontent.com/wottyup/star-accounting/${encodeURIComponent(tag)}`;
  const configResponse = await fetcher(`${tagRoot}/app/version.json`, { signal, cache: "no-store" });
  let versionCode: number;
  let versionName: string | undefined;
  if (configResponse.ok) {
    const config: unknown = await configResponse.json();
    validateVersionConfig(config);
    versionCode = config.public.versionCode;
    versionName = config.public.versionName;
    if (versionCode !== config.lastVersionCode) throw new Error("GitHub 公开发布版本码已过期。");
  } else if (configResponse.status === 404) {
    // Older tags stored literal versions here. Only a missing new config permits fallback.
    const sourceResponse = await fetcher(`${tagRoot}/app/src/lib/stark/app-version.ts`, { signal, cache: "no-store" });
    if (!sourceResponse.ok) throw new Error("无法读取 GitHub 发布版本码。");
    const source = await sourceResponse.text();
    versionCode = Number(source.match(/^export const CURRENT_APP_VERSION_CODE\s*=\s*(\d+)\s*;/m)?.[1]);
    versionName = source.match(/^export const CURRENT_APP_VERSION_NAME\s*=\s*["']([^"']+)["']\s*;/m)?.[1];
  } else {
    throw new Error("无法读取 GitHub 发布版本码。");
  }

  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000 || versionName !== tag.slice(1)) {
    throw new Error("GitHub 发布标签与应用版本不一致。");
  }

  const apkName = `star-accounting-v${versionName}.apk`;
  const apkUrl = `https://github.com/wottyup/star-accounting/releases/download/${encodeURIComponent(tag)}/${apkName}`;
  const matchingAssets = (release.assets as unknown[]).filter((asset: unknown) => {
    if (!asset || typeof asset !== "object") return false;
    const item = asset as Record<string, unknown>;
    return item.name === apkName && item.browser_download_url === apkUrl && item.state === "uploaded";
  });
  return {
    versionCode,
    versionName,
    // The existing Android release workflow publishes only the KT hybrid edition.
    edition: "ktweb",
    apkUrl: matchingAssets.length === 1 ? apkUrl : null,
    changelog: typeof release.body === "string" ? release.body : "",
    forceUpdate: false,
  };
}

type AppUpdateDownloadBridge = {
  getLanUpdateManifest(options: { url: string }): Promise<AppVersionInfo>;
  downloadAndInstall(options: { url: string; versionCode: number }): Promise<{ installationStarted: boolean }>;
};

export async function downloadAppUpdate(manifestUrl: string, info: AppVersionInfo, bridge: AppUpdateDownloadBridge) {
  if (!info.apkUrl) throw new Error("更新缺少安装包地址，请重新检查更新。");
  if (new URL(manifestUrl).protocol === "http:") {
    // The native downloader accepts HTTP only after validating the LAN origin.
    const approved = await bridge.getLanUpdateManifest({ url: manifestUrl });
    if (approved.versionCode !== info.versionCode || approved.apkUrl !== info.apkUrl || approved.edition !== info.edition) {
      throw new Error("版本信息已变化，请关闭弹窗后重新检查更新。");
    }
  }
  return bridge.downloadAndInstall({ url: info.apkUrl, versionCode: info.versionCode });
}
