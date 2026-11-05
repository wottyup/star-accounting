const STORAGE_KEY = "wotty:stark:lan-update-url";
const OFFICIAL_SOURCE = "official";
const BUILD_LAN_UPDATE_URL = process.env.NEXT_PUBLIC_STARK_LAN_UPDATE_URL?.trim() ?? "";

function isPrivateIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) return false;
  const values = parts.map(Number);
  if (values.some((value) => value > 255)) return false;
  return values[0] === 10
    || (values[0] === 172 && values[1] >= 16 && values[1] <= 31)
    || (values[0] === 192 && values[1] === 168);
}

export function normalizeLanUpdateUrl(input: string) {
  const value = input.trim();
  if (!value) throw new Error("请输入局域网版本接口地址。");
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `http://${value}`);
  } catch {
    throw new Error("请输入有效地址，例如 http://10.126.126.3:18767/version.json。");
  }
  if (url.protocol !== "http:" || !isPrivateIpv4(url.hostname) || url.username || url.password || url.hash) {
    throw new Error("局域网地址须使用私有 IPv4 的 HTTP 链接。");
  }
  if (url.pathname === "/") url.pathname = "/version.json";
  return url.toString();
}

export function readLanUpdateUrl() {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === OFFICIAL_SOURCE) return null;
    const source = value || BUILD_LAN_UPDATE_URL;
    return source ? normalizeLanUpdateUrl(source) : null;
  } catch {
    return null;
  }
}

export function saveLanUpdateUrl(value: string | null) {
  if (value === null) {
    if (BUILD_LAN_UPDATE_URL) window.localStorage.setItem(STORAGE_KEY, OFFICIAL_SOURCE);
    else window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, normalizeLanUpdateUrl(value));
  }
  window.dispatchEvent(new Event("stark:update-source-change"));
}
