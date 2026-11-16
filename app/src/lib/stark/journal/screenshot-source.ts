import { Capacitor, registerPlugin } from "@capacitor/core";

type SourceResult = { status: string; id?: string; name?: string; mimeType?: string; url?: string };
type SourceBridge = {
  pick(): Promise<SourceResult>;
  trash(options: { sourceId: string }): Promise<SourceResult>;
  forget(options: { sourceId: string }): Promise<void>;
};
const nativeSource = registerPlugin<SourceBridge>("ScreenshotSource");

export function isScreenshotSourceAvailable() {
  if (typeof window === "undefined") return false;
  return Boolean(window.AndroidFloatingJournal?.screenshot)
    || Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ScreenshotSource");
}

function floatingRequest(operation: string, sourceId = ""): Promise<SourceResult> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = (event: Event) => {
      const result = (event as CustomEvent<SourceResult & { requestId: string }>).detail;
      if (result.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("stark:screenshot-result", finish);
      resolve(result);
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener("stark:screenshot-result", finish);
      reject(new Error("Screenshot action timed out"));
    }, 10 * 60_000);
    window.addEventListener("stark:screenshot-result", finish);
    try { window.AndroidFloatingJournal!.screenshot!(operation, requestId, sourceId); }
    catch (error) {
      window.clearTimeout(timer);
      window.removeEventListener("stark:screenshot-result", finish);
      reject(error);
    }
  });
}

export async function pickScreenshotSource(): Promise<{ file: File; sourceId: string } | null> {
  const result = window.AndroidFloatingJournal?.screenshot ? await floatingRequest("pick") : await nativeSource.pick();
  if (result.status === "cancelled") return null;
  if (result.status !== "selected" || !result.id || !result.url) throw new Error("无法读取截图，请重新选择 PNG、JPG 或 WebP 图片");
  try {
    const response = await fetch(result.url, { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取截图，请重新选择 PNG、JPG 或 WebP 图片");
    const blob = await response.blob();
    if (blob.size > 10 * 1024 * 1024) throw new Error("图片超过 10 MiB，请压缩后重试");
    return { sourceId: result.id, file: new File([blob], result.name || "screenshot", { type: result.mimeType || blob.type }) };
  } catch (error) {
    await forgetScreenshotSource(result.id);
    throw error;
  }
}

export function trashScreenshotSource(sourceId: string) {
  return window.AndroidFloatingJournal?.screenshot ? floatingRequest("trash", sourceId) : nativeSource.trash({ sourceId });
}

export async function forgetScreenshotSource(sourceId: string) {
  try {
    if (window.AndroidFloatingJournal?.screenshot) window.AndroidFloatingJournal.screenshot("forget", "", sourceId);
    else await nativeSource.forget({ sourceId });
  } catch { /* Releasing a grant must never change an accounting outcome. */ }
}
