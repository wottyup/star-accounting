"use client";

import { useCallback, useEffect, useState } from "react";
import { floatingJournal, isFloatingJournalAvailable, type FloatingJournalStatus } from "@/lib/stark/floating-journal";
import { translateText, useAppLocale } from "@/lib/stark/i18n";

const emptyStatus: FloatingJournalStatus = {
  overlayAllowed: false,
  serviceActive: false,
  captureActive: false,
};

export function FloatingJournalSettings() {
  const locale = useAppLocale();
  const [status, setStatus] = useState(emptyStatus);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const available = isFloatingJournalAvailable();

  const refresh = useCallback(async () => {
    if (!available) return null;
    try {
      const next = await floatingJournal().getStatus();
      setStatus(next);
      return next;
    } catch {
      setNotice(translateText("无法读取悬浮记账状态，请重新打开此页面。", locale));
      return null;
    }
  }, [available, locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function refreshAfterServiceChange(delay = 400) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    return refresh();
  }

  async function enableOverlay() {
    setBusy(true);
    setNotice("");
    try {
      const result = await floatingJournal().enableOverlay();
      await refreshAfterServiceChange();
      setNotice(result.enabled
        ? translateText("悬浮按钮已开启。屏幕识别需要另外允许屏幕共享；也可以直接上传图片。", locale)
        : translateText("尚未获得悬浮窗权限；你仍可在记账页面手动记账。", locale));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translateText("开启悬浮按钮失败，请重试。", locale));
    } finally {
      setBusy(false);
    }
  }

  async function enableCapture() {
    setBusy(true);
    setNotice("");
    try {
      const result = await floatingJournal().requestScreenCapture();
      const latest = await refreshAfterServiceChange(700);
      setNotice(result.enabled && latest?.captureActive
        ? translateText("屏幕识别已开启。系统会显示屏幕共享提示，点击悬浮按钮时才会截取当前画面。", locale)
        : result.enabled
          ? translateText("屏幕识别未能启动；你仍可以使用悬浮上传图片或手动记账。", locale)
          : translateText("未授权屏幕共享；上传图片和手动记账仍可用，请先开启屏幕识别再识别当前屏幕。", locale));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translateText("开启屏幕识别失败，请重试。", locale));
    } finally {
      setBusy(false);
    }
  }

  async function stopCapture() {
    setBusy(true);
    setNotice("");
    try {
      await floatingJournal().stopScreenCapture();
      await refreshAfterServiceChange();
      setNotice(translateText("屏幕共享已停止，悬浮按钮和图片识别仍可使用。", locale));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translateText("无法停止屏幕识别，请重试。", locale));
    } finally {
      setBusy(false);
    }
  }

  async function disableAll() {
    setBusy(true);
    setNotice("");
    try {
      await floatingJournal().disable();
      setStatus(emptyStatus);
      setNotice(translateText("悬浮记账已关闭。", locale));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translateText("关闭悬浮记账失败，请重试。", locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-sheet-body floating-journal-settings">
      <p className="settings-sheet-note">
        {translateText("悬浮菜单提供“识别当前屏幕”和“上传图片识别”。识别结果会进入可编辑的记账表单，不会自动保存。", locale)}
      </p>
      <div className="floating-journal-permission-status">
        <div><span>{translateText("悬浮按钮", locale)}</span><strong>{status.serviceActive && status.overlayAllowed ? translateText("已开启", locale) : translateText("未开启", locale)}</strong></div>
        <div><span>{translateText("屏幕识别", locale)}</span><strong>{status.captureActive ? translateText("已授权", locale) : translateText("未授权", locale)}</strong></div>
      </div>
      <p className="settings-sheet-tip">
        {translateText("屏幕共享会保持开启并显示系统提示；星会计只在你点悬浮菜单识屏时处理当前画面。遇到支付 App 禁止截屏时，可以直接在记账表单手动填写，或改用上传图片。", locale)}
      </p>
      {!status.serviceActive || !status.overlayAllowed ? (
        <button type="button" className="settings-sheet-primary" disabled={busy || !available} onClick={() => void enableOverlay()}>
          {busy ? translateText("处理中…", locale) : status.serviceActive ? translateText("重新开启悬浮按钮", locale) : translateText("开启悬浮按钮", locale)}
        </button>
      ) : (
        <>
          {!status.captureActive ? (
            <button type="button" className="settings-sheet-primary" disabled={busy} onClick={() => void enableCapture()}>
              {busy ? translateText("处理中…", locale) : translateText("开启屏幕识别", locale)}
            </button>
          ) : (
            <button type="button" className="settings-confirm-button floating-journal-stop-capture" disabled={busy} onClick={() => void stopCapture()}>
              {busy ? translateText("处理中…", locale) : translateText("停止屏幕共享", locale)}
            </button>
          )}
          <button type="button" className="settings-confirm-button floating-journal-disable" disabled={busy} onClick={() => void disableAll()}>
            {translateText("关闭悬浮记账", locale)}
          </button>
        </>
      )}
      {notice ? <div className="cloud-test-status">{notice}</div> : null}
    </div>
  );
}
