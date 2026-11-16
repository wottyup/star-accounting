export const CURRENT_APP_VERSION_CODE = 232;
export const CURRENT_APP_VERSION_NAME = "0.23.1-dev.1";
export const APP_UPDATE_URL = "http://10.126.126.3:18767/version.json";

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
