import { registerPlugin } from "@capacitor/core";

type BillExportBridge = {
  begin(options: { fileName: string; totalBytes: number }): Promise<{ id: string }>;
  append(options: { id: string; data: string }): Promise<void>;
  finish(options: { id: string }): Promise<{ location: string }>;
  abort(options: { id: string }): Promise<void>;
};

const nativeBillExport = registerPlugin<BillExportBridge>("BillExport");
const CHUNK_BYTES = 24 * 1024;

/** Keep each WebView-to-Android message small, even for years of bill history. */
export async function saveBillCsvOnAndroid(csv: string, fileName: string, onProgress?: (percent: number) => void) {
  const bytes = new TextEncoder().encode(csv);
  const { id } = await nativeBillExport.begin({ fileName, totalBytes: bytes.length });
  let lastPercent = 0;
  try {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const part = bytes.subarray(offset, offset + CHUNK_BYTES);
      let binary = "";
      for (const byte of part) binary += String.fromCharCode(byte);
      await nativeBillExport.append({ id, data: btoa(binary) });
      const percent = Math.floor((offset + part.length) * 100 / bytes.length);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        onProgress?.(percent);
      }
    }
    return await nativeBillExport.finish({ id });
  } catch (error) {
    await nativeBillExport.abort({ id }).catch(() => undefined);
    throw error;
  }
}
