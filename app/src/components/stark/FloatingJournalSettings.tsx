"use client";

import { useCallback, useEffect, useState } from "react";
import { floatingJournal, isFloatingJournalAvailable, type FloatingJournalStatus } from "@/lib/stark/floating-journal";
import { translateText, useAppLocale } from "@/lib/stark/i18n";

const emptyStatus: FloatingJournalStatus = {
  overlayAllowed: false,
  serviceActive: false,
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
        ? translateText("悬浮按钮已开启，点击后会直接打开记账页面。", locale)
        : translateText("尚未获得悬浮窗权限，请在系统设置中允许星会计显示在其他应用上层。", locale));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translateText("开启悬浮按钮失败，请重试。", locale));
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

  const isActive = status.serviceActive && status.overlayAllowed;

  return (
    <div className="settings-sheet-body floating-journal-settings">
      <p className="settings-sheet-note">
        {translateText("点击悬浮按钮会直接打开记账表单。需要识别支付截图时，在表单里点“截图识别”并选择图片。", locale)}
      </p>
      <div className="floating-journal-permission-status">
        <div><span>{translateText("悬浮按钮", locale)}</span><strong>{isActive ? translateText("已开启", locale) : translateText("未开启", locale)}</strong></div>
      </div>
      {!isActive ? (
        <button type="button" className="settings-sheet-primary" disabled={busy || !available} onClick={() => void enableOverlay()}>
          {busy ? translateText("处理中…", locale) : status.serviceActive ? translateText("重新开启悬浮按钮", locale) : translateText("开启悬浮按钮", locale)}
        </button>
      ) : (
        <button type="button" className="settings-confirm-button floating-journal-disable" disabled={busy} onClick={() => void disableAll()}>
          {busy ? translateText("处理中…", locale) : translateText("关闭悬浮记账", locale)}
        </button>
      )}
      {notice ? <div className="cloud-test-status">{notice}</div> : null}
    </div>
  );
}
