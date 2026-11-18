export const CURRENT_APP_VERSION_CODE = 240;
export const CURRENT_APP_VERSION_NAME = "0.25.1-dev.1";
export const APP_UPDATE_URL = "https://api.github.com/repos/wottyup/star-accounting/releases/latest";

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

/** Release tags are built only after checking source versions against the APK. */
export async function fetchLatestAppVersion(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<AppVersionInfo> {
  const response = await fetcher(APP_UPDATE_URL, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error("GitHub 版本服务暂时不可用。");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("GitHub 发布信息无效。");
  const release = value as Record<string, unknown>;
  const tag = release.tag_name;
  if (release.draft !== false || typeof tag !== "string"
    || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(tag)
    || !Array.isArray(release.assets)) {
    throw new Error("GitHub 发布版本或附件信息无效。");
  }

  // Read versionCode from the same release tag, never from the main branch
  // or a guessed conversion of its semantic version name.
  const sourceResponse = await fetcher(
    `https://raw.githubusercontent.com/wottyup/star-accounting/${encodeURIComponent(tag)}/app/src/lib/stark/app-version.ts`,
    { signal, cache: "no-store" },
  );
  if (!sourceResponse.ok) throw new Error("无法读取 GitHub 发布版本码。");
  const source = await sourceResponse.text();
  const versionCode = Number(source.match(/^export const CURRENT_APP_VERSION_CODE\s*=\s*(\d+)\s*;/m)?.[1]);
  const versionName = source.match(/^export const CURRENT_APP_VERSION_NAME\s*=\s*["']([^"']+)["']\s*;/m)?.[1];
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionName !== tag.slice(1)) {
    throw new Error("GitHub 发布标签与应用版本不一致。");
  }

  const apkName = `star-accounting-v${versionName}.apk`;
  const apkUrl = `https://github.com/wottyup/star-accounting/releases/download/${encodeURIComponent(tag)}/${apkName}`;
  const matchingAssets = release.assets.filter((asset: unknown) => {
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
