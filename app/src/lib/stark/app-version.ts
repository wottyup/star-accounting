export const CURRENT_APP_VERSION_CODE = 224;
export const CURRENT_APP_VERSION_NAME = "0.20.7-dev.1";
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
