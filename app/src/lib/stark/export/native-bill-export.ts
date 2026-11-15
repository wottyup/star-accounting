import { registerPlugin } from "@capacitor/core";

type DataExportBridge = {
  begin(options: { fileName: string; totalBytes: number; mimeType: string }): Promise<{ id: string }>;
  append(options: { id: string; data: string }): Promise<void>;
  finish(options: { id: string }): Promise<{ location: string }>;
  abort(options: { id: string }): Promise<void>;
};

const nativeDataExport = registerPlugin<DataExportBridge>("BillExport");
const CHUNK_BYTES = 24 * 1024;

/** Keep each WebView-to-Android message small, even for large account archives. */
export async function saveExportFileOnAndroid(
  content: string,
  fileName: string,
  mimeType: string,
  onProgress?: (percent: number) => void,
) {
  const bytes = new TextEncoder().encode(content);
  const { id } = await nativeDataExport.begin({ fileName, totalBytes: bytes.length, mimeType });
  let lastPercent = 0;
  try {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const part = bytes.subarray(offset, offset + CHUNK_BYTES);
      let binary = "";
      for (const byte of part) binary += String.fromCharCode(byte);
      await nativeDataExport.append({ id, data: btoa(binary) });
      const percent = Math.floor((offset + part.length) * 100 / bytes.length);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        onProgress?.(percent);
      }
    }
    return await nativeDataExport.finish({ id });
  } catch (error) {
    await nativeDataExport.abort({ id }).catch(() => undefined);
    throw error;
  }
}

export function saveBillCsvOnAndroid(csv: string, fileName: string, onProgress?: (percent: number) => void) {
  return saveExportFileOnAndroid(csv, fileName, "text/csv", onProgress);
}
