import { getCloudAuthToken } from "@/lib/stark/storage/cloud-auth";
import { getCloudApiUrl } from "@/lib/stark/storage/local-config";

export type AIVisionSettings = {
  configured: boolean;
  source: "personal" | "server";
  baseUrl: string;
  apiFormat: "openai" | "anthropic";
  model: string;
  hasApiKey: boolean;
  hasPersonalConfiguration: boolean;
  encryptionReady: boolean;
  privateEndpointsAllowed: boolean;
};

type MessageResponse = { message?: string; error?: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = getCloudApiUrl().replace(/\/$/, "");
  if (!baseUrl) throw new Error("未配置云端 API 地址");
  const token = getCloudAuthToken();
  if (!token) throw new Error("请先登录云端账户");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({})) as T & MessageResponse;
    if (!response.ok) throw new Error(body.error || "云端请求失败，请稍后重试");
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("AI 设置请求超时，请检查网络");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getAIVisionSettings() {
  return request<AIVisionSettings>("/api/settings/ai-vision");
}

export function saveAIVisionSettings(input: { baseUrl: string; apiFormat: "openai" | "anthropic"; model: string; apiKey: string }) {
  return request<MessageResponse>("/api/settings/ai-vision", { method: "PUT", body: JSON.stringify(input) });
}

export function testAIVisionSettings(input: { baseUrl: string; apiFormat: "openai" | "anthropic"; model: string; apiKey: string }) {
  return request<MessageResponse>("/api/settings/ai-vision/test", { method: "POST", body: JSON.stringify(input) });
}

export function restoreDefaultAIVisionSettings() {
  return request<MessageResponse>("/api/settings/ai-vision", { method: "DELETE" });
}
