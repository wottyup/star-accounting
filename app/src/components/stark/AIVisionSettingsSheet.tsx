"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAIVisionSettings,
  restoreDefaultAIVisionSettings,
  saveAIVisionSettings,
  testAIVisionSettings,
  type AIVisionSettings,
} from "@/lib/stark/repository/ai-vision-settings";

export function AIVisionSettingsSheet() {
  const [settings, setSettings] = useState<AIVisionSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getAIVisionSettings();
      setSettings(result);
      setBaseUrl(result.baseUrl);
      setModel(result.model);
      setApiKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取 AI 设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function formValues() {
    return { baseUrl: baseUrl.trim(), model: model.trim(), apiKey };
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const result = await saveAIVisionSettings(formValues());
      setMessage(result.message || "AI 设置已保存");
      setApiKey("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存 AI 设置失败");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage("");
    setError("");
    try {
      const result = await testAIVisionSettings(formValues());
      setMessage(result.message || "模型服务连接成功");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模型服务连接失败");
    } finally {
      setTesting(false);
    }
  }

  async function restoreDefault() {
    setRestoring(true);
    setMessage("");
    setError("");
    try {
      const result = await restoreDefaultAIVisionSettings();
      setMessage(result.message || "已恢复服务器默认配置");
      setConfirmRestore(false);
      setApiKey("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复服务器默认配置失败");
    } finally {
      setRestoring(false);
    }
  }

  const busy = loading || saving || testing || restoring;
  const needsPersonalKey = !settings?.hasPersonalConfiguration && !apiKey.trim();

  return (
    <div className="settings-sheet-body ai-vision-settings">
      <p className="settings-sheet-note">配置截图记账使用的 OpenAI 兼容视觉模型。API Key 会加密保存在云端账户中，不会回传或写入账本。</p>

      {loading ? <div className="bill-import-message">正在读取 AI 设置…</div> : null}

      {settings ? (
        <div className={`ai-vision-status ${settings.configured ? "ready" : "not-ready"}`}>
          <strong>{settings.configured ? "截图识别已配置" : "尚未配置可用模型"}</strong>
          <span>{settings.source === "personal" ? "当前使用个人配置" : "当前使用服务器默认配置"}</span>
          <small>{settings.hasApiKey ? "API Key 已设置（出于安全原因不显示）" : "服务器默认 API Key 尚未配置"}</small>
        </div>
      ) : null}

      {!settings?.encryptionReady && !loading ? (
        <div className="ai-vision-warning">服务器未配置 AI 密钥加密项，暂时无法保存个人 API Key。请联系服务器管理员。</div>
      ) : null}
      {settings?.hasPersonalConfiguration && !settings.configured ? (
        <div className="ai-vision-warning">个人 API Key 无法解密，请重新填写 API Key 并保存。</div>
      ) : null}

      <label className="ai-vision-field">
        <span>服务地址</span>
        <input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" disabled={loading} />
      </label>
      <label className="ai-vision-field">
        <span>模型名称</span>
        <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4o-mini" disabled={loading} />
      </label>
      <label className="ai-vision-field">
        <span>API Key {settings?.hasPersonalConfiguration ? "（留空保留已保存密钥）" : ""}</span>
        <input type="password" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.hasPersonalConfiguration ? "已安全保存，输入新密钥可替换" : "粘贴模型服务的 API Key"} disabled={loading} />
      </label>

      {settings?.privateEndpointsAllowed ? (
        <p className="settings-sheet-tip">服务器已允许私有模型地址。确认服务地址来自可信来源。</p>
      ) : (
        <p className="settings-sheet-tip">仅支持 HTTPS 公网服务。连接本机或内网模型需由服务器管理员开启允许。</p>
      )}

      {message ? <div className="bill-import-message success" role="status">{message}</div> : null}
      {error ? <div className="bill-import-message error" role="alert">{error}</div> : null}

      <div className="ai-vision-actions">
        <button type="button" className="ai-vision-secondary" disabled={busy || needsPersonalKey} onClick={() => void test()}>{testing ? "正在测试…" : "测试连接"}</button>
        <button type="button" className="settings-sheet-primary" disabled={busy || !settings?.encryptionReady || !baseUrl.trim() || !model.trim() || needsPersonalKey} onClick={() => void save()}>{saving ? "正在保存…" : "保存配置"}</button>
      </div>

      {settings?.hasPersonalConfiguration ? (
        <div className="ai-vision-restore">
          {confirmRestore ? (
            <>
              <span>恢复后将删除个人模型配置，并改用服务器默认配置。</span>
              <button type="button" disabled={busy} onClick={() => void restoreDefault()}>{restoring ? "正在恢复…" : "确认恢复默认"}</button>
              <button type="button" disabled={busy} onClick={() => setConfirmRestore(false)}>取消</button>
            </>
          ) : <button type="button" disabled={busy} onClick={() => setConfirmRestore(true)}>恢复服务器默认配置</button>}
        </div>
      ) : null}
    </div>
  );
}
