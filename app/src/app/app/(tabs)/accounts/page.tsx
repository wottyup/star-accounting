"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import packageInfo from "../../../../../package.json";
import { PageTopBar } from "@/components/stark/PageTopBar";
import { SettingsPictogram, type SettingPictogramType } from "@/components/stark/SettingsPictogram";
import type { Account, DataMode, ImportErrorLog, ImportFailedRow, Transaction } from "@/lib/stark/models";
import { DataModeManager } from "@/lib/stark/repository/DataModeManager";
import { REMOTE_CACHE_UPDATED_EVENT, type RemoteCacheUpdate } from "@/lib/stark/repository/RemoteRepository";
import { getCloudApiUrl, getCurrentAccountId, getCurrentDataMode } from "@/lib/stark/storage/local-config";
import { cloudLogout, cloudRegistrationStatus, cloudResetPassword, cloudSetRegistrationEnabled } from "@/lib/stark/repository/cloud-auth";
import { getCloudAuthUser } from "@/lib/stark/storage/cloud-auth";
import { nowText } from "@/lib/stark/utils/format";
import { createId } from "@/lib/stark/utils/id";
import { applyCategoryRules } from "@/lib/stark/dashboard/remark";
import { serializeAccountArchiveToJson } from "@/lib/stark/export/account-archive";
import { saveExportFileOnAndroid } from "@/lib/stark/export/native-bill-export";
import { buildImportErrorLogs, selectFailedImportTransactions } from "@/lib/stark/import/import-errors";
import { matchImportedLoanRepayments } from "@/lib/stark/import/loan-repayment";
import { importedTransactionId } from "@/lib/stark/import/import-id";
import { BillRemarkSheet } from "@/components/stark/BillRemarkSheet";
import { SubscriptionManagementSheet } from "@/components/stark/SubscriptionManagementSheet";
import { AIVisionSettingsSheet } from "@/components/stark/AIVisionSettingsSheet";
import { FloatingJournalSettings } from "@/components/stark/FloatingJournalSettings";
import { AccountReconciliationSheet } from "@/components/stark/AccountReconciliationSheet";
import { BottomSheet } from "@/components/stark/BottomSheet";
import { useLayeredHistoryMarker } from "@/components/stark/useLayeredHistoryMarker";
import { applyUiSettings, defaultUiSettings, readUiSettings, saveUiSettings, type FontChoice, type LanguageChoice, type UiSettings } from "@/lib/stark/storage/ui-settings";
import { getAppUpdateAvailable, subscribeAppUpdateAvailable } from "@/lib/stark/app-update-status";
import type { BillImportSource } from "@/lib/stark/import/bill-csv";
import { withAppBasePath } from "@/lib/stark/runtime";
import type { DataRepository } from "@/lib/stark/repository/DataRepository";

const manager = new DataModeManager();
type PanelKey = Exclude<SettingPictogramType, "UPDATE">;
type SettingIconKey = SettingPictogramType;
const languageLabels: Record<LanguageChoice, string> = { SYSTEM: "跟随系统", ZH_CN: "简体中文", EN_US: "English" };
const fontLabels: Record<FontChoice, string> = { SMALL: "较小", STANDARD: "标准", LARGE: "较大" };

type PendingBillImport = {
  fileName: string;
  platform: BillImportSource;
  transactions: Transaction[];
};

async function saveImportLogsInBackground(repository: DataRepository, logs: ImportErrorLog[]) {
  for (let index = 0; index < logs.length; index += 5) {
    await Promise.allSettled(logs.slice(index, index + 5).map((log) => repository.saveImportErrorLog(log)));
  }
}

function importFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/401|未登录|登录已失效/.test(message)) return "登录已失效";
  if (/超时|abort/i.test(message)) return "请求超时";
  const status = message.match(/Cloud API (\d{3})/);
  if (status) return `服务返回 HTTP ${status[1]}`;
  return "网络或数据源异常";
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
}

function SettingsRow({ type, title, value, onClick, disabled = false, updateAvailable = false }: { type: SettingIconKey; title: string; value?: string; onClick: () => void; disabled?: boolean; updateAvailable?: boolean }) {
  return (
    <button type="button" className={`settings-center-row${disabled ? " disabled" : ""}`} onClick={onClick} disabled={disabled} aria-disabled={disabled}>
      <span className={`settings-center-icon ${type.toLowerCase()}`}><SettingsPictogram type={type} /></span>
      <strong><span className="settings-center-label">{title}</span>{updateAvailable ? <span className="settings-update-dot" role="img" aria-label="有新版本可用" /> : null}</strong>
      {value ? <span className="settings-center-value">{value}</span> : null}
      <span className="settings-center-chevron"><ChevronIcon /></span>
    </button>
  );
}

export default function AccountsPage() {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [isAndroidApp, setIsAndroidApp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [mode, setMode] = useState<DataMode>("CLOUD");
  const [ledgerAccount, setLedgerAccount] = useState<Account | null>(null);
  const [ledgerAccountStatus, setLedgerAccountStatus] = useState<"loading" | "ready" | "error">("loading");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [registrationError, setRegistrationError] = useState("");
  const [registrationMessage, setRegistrationMessage] = useState("");
  const [cloudUser, setCloudUser] = useState(() => getCloudAuthUser());
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [uiSettings, setUiSettings] = useState<UiSettings>(defaultUiSettings);
  const [importPlatform, setImportPlatform] = useState<BillImportSource>("微信");
  const [importMessage, setImportMessage] = useState("支持微信、支付宝官方导出的 CSV / Excel 账单，以及本应用导出的 CSV 账单");
  const [importing, setImporting] = useState(false);
  const [importInterrupted, setImportInterrupted] = useState(false);
  const [readingBill, setReadingBill] = useState(false);
  const [pendingBillImport, setPendingBillImport] = useState<PendingBillImport | null>(null);
  const [importErrors, setImportErrors] = useState<ImportErrorLog[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("将导出当前账本的完整业务数据为 JSON 文件");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dismissLogoutConfirm = useCallback(() => setLogoutConfirmOpen(false), []);
  const consumeLogoutHistory = useLayeredHistoryMarker(logoutConfirmOpen, "starkLogoutConfirm", dismissLogoutConfirm);
  const closeLogoutConfirm = useCallback(() => {
    consumeLogoutHistory();
    dismissLogoutConfirm();
  }, [consumeLogoutHistory, dismissLogoutConfirm]);

  useEffect(() => {
    setIsAndroidApp(Capacitor.getPlatform() === "android");
    const saved = readUiSettings();
    setUiSettings(saved);
    applyUiSettings(saved);
    const savedMode = getCurrentDataMode() as DataMode;
    setMode(savedMode);
    void manager.getRepository().getImportErrorLogs(getCurrentAccountId()).then(setImportErrors).catch(() => setImportErrors([]));
    if (savedMode === "CLOUD" && getCloudAuthUser()) void loadRegistrationStatus();
  }, []);

  useEffect(() => {
    let active = true;
    const loadLedgerAccount = () => {
      setLedgerAccountStatus("loading");
      void manager.getRepository().getAccount(getCurrentAccountId())
        .then((account) => {
          if (!active) return;
          setLedgerAccount(account);
          setLedgerAccountStatus("ready");
        })
        .catch(() => {
          if (!active) return;
          setLedgerAccount(null);
          setLedgerAccountStatus("error");
        });
    };
    const handleRemoteCacheUpdate = (event: Event) => {
      if ((event as CustomEvent<RemoteCacheUpdate>).detail?.resource === "accounts") loadLedgerAccount();
    };
    loadLedgerAccount();
    window.addEventListener("stark:account-saved", loadLedgerAccount);
    window.addEventListener("stark:data-mode-changed", loadLedgerAccount);
    window.addEventListener(REMOTE_CACHE_UPDATED_EVENT, handleRemoteCacheUpdate);
    return () => {
      active = false;
      window.removeEventListener("stark:account-saved", loadLedgerAccount);
      window.removeEventListener("stark:data-mode-changed", loadLedgerAccount);
      window.removeEventListener(REMOTE_CACHE_UPDATED_EVENT, handleRemoteCacheUpdate);
    };
  }, [mode]);

  useEffect(() => {
    setUpdateAvailable(getAppUpdateAvailable());
    return subscribeAppUpdateAvailable(() => setUpdateAvailable(getAppUpdateAvailable()));
  }, []);

  function updateUiSetting<K extends keyof UiSettings>(key: K, value: UiSettings[K]) {
    setUiSettings((current) => {
      const next = { ...current, [key]: value };
      saveUiSettings(next);
      applyUiSettings(next);
      return next;
    });
  }

  function openAccountSettings() {
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setPasswordMessage("");
    setAdminKey("");
    setRegistrationError("");
    setRegistrationMessage("");
    setActivePanel("ACCOUNT");
    void loadRegistrationStatus();
  }

  async function loadRegistrationStatus() {
    const url = getCloudApiUrl().replace(/\/$/, "");
    if (!url) {
      setRegistrationError("未配置云端 API 地址");
      return;
    }
    setRegistrationLoading(true);
    try {
      const result = await cloudRegistrationStatus(url);
      setRegistrationEnabled(result.registrationEnabled);
      setRegistrationError("");
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : "无法读取注册状态");
    } finally {
      setRegistrationLoading(false);
    }
  }

  async function submitRegistrationChange() {
    if (!adminKey.trim()) {
      setRegistrationError("请输入管理员恢复密钥");
      setRegistrationMessage("");
      return;
    }
    setRegistrationSubmitting(true);
    setRegistrationError("");
    setRegistrationMessage("");
    try {
      const url = getCloudApiUrl().replace(/\/$/, "");
      const result = await cloudSetRegistrationEnabled(url, !registrationEnabled, adminKey);
      setRegistrationEnabled(result.registrationEnabled);
      setAdminKey("");
      setRegistrationMessage(result.registrationEnabled ? "已开启新用户注册" : "已关闭新用户注册");
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : "注册设置更新失败");
    } finally {
      setRegistrationSubmitting(false);
    }
  }

  function selectImportPlatform(platform: BillImportSource) {
    setImportPlatform(platform);
    setPendingBillImport(null);
    setImportInterrupted(false);
    setImportMessage(platform === "本应用导出" ? "请选择本应用导出的 CSV 账单" : `请选择${platform}官方导出的 CSV / Excel 账单`);
  }

  async function submitPasswordReset() {
    if (!newPassword || !confirmPassword) {
      setPasswordError("请完整填写密码信息");
      setPasswordMessage("");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("新密码至少需要 8 位");
      setPasswordMessage("");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      setPasswordMessage("");
      return;
    }
    setPasswordSubmitting(true);
    setPasswordError("");
    setPasswordMessage("");
    try {
      const url = getCloudApiUrl().replace(/\/$/, "");
      await cloudResetPassword(url, newPassword, confirmPassword);
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码已重置成功，请妥善保管新密码");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "密码重置失败，请稍后重试");
    } finally {
      setPasswordSubmitting(false);
    }
  }

  function logout() {
    cloudLogout();
    setCloudUser(null);
    // The confirmation dialog owns a temporary history entry. Calling
    // history.back() and navigating away in the same event races in Android
    // WebView, which can leave the protected route mounted with no session.
    // A hard replacement drops that transient entry and always boots the
    // access gate from a clean URL.
    window.location.replace("/");
  }

  function requestLogout() {
    setLogoutConfirmOpen(true);
  }

  function openModeSwitch() {
    router.replace("/");
  }

  async function prepareBillImport(file: File) {
    setReadingBill(true);
    setPendingBillImport(null);
    setImportInterrupted(false);
    setImportMessage("正在读取账单...");
    try {
      const { parseBillFile } = await import("@/lib/stark/import/bill-csv");
      const rows = await parseBillFile(file, importPlatform);
      if (!rows.length) {
        setImportMessage(importPlatform === "本应用导出" ? "没有识别到本应用导出的有效流水，请确认选择的是导出的 CSV 账单" : `没有识别到有效${importPlatform}流水，请确认这是官方导出的 CSV / Excel 账单`);
        return;
      }

      const now = nowText();
      const accountId = getCurrentAccountId();
      const transactions: Transaction[] = rows.map((row, index) => ({
        id: importedTransactionId(accountId, file.name, importPlatform, row, index), sourceId: row.sourceId ?? null,
        userId: "local-user", accountId,
        amount: row.amount, type: row.type, category: row.category, platform: row.platform,
        shoppingPlatform: row.shoppingPlatform ?? null, merchant: row.merchant, date: row.date, description: row.description,
        orderId: row.orderId, paymentMethod: row.paymentMethod, status: row.status, loanId: null, remarkCategory: row.remarkCategory ?? null,
        createdAt: now, updatedAt: now,
      }));
      setPendingBillImport({ fileName: file.name, platform: importPlatform, transactions });
      setImportMessage(`已识别 ${file.name}：${importPlatform}账单，共 ${transactions.length} 笔。确认后才会导入。`);
    } catch {
      setImportMessage("读取账单失败，请确认文件未损坏且为 CSV / XLS / XLSX 格式。");
    } finally {
      setReadingBill(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function confirmBillImport() {
    if (!pendingBillImport || importing) return;
    const total = pendingBillImport.transactions.length;
    let completed = 0;
    setImporting(true);
    setImportInterrupted(false);
    setImportMessage(`正在导入 ${total} 笔${pendingBillImport.platform}账单，已处理 0 笔...`);
    try {
      const repository = manager.getRepository();
      const accountId = getCurrentAccountId();
      const [rules, loans] = await Promise.all([
        repository.getCategoryRules(accountId),
        repository.getLoans(accountId),
      ]);
      const categorizedTransactions = applyCategoryRules(pendingBillImport.transactions, rules);
      const matched = matchImportedLoanRepayments(categorizedTransactions, loans);
      const result = await repository.importTransactions(matched.transactions, (count) => {
        completed = count;
        setImportMessage(`正在导入 ${total} 笔${pendingBillImport.platform}账单，已处理 ${count} 笔...`);
      });
      const repaymentSummary = result.loanRepayments
        ? `，自动关联 ${result.loanRepayments} 笔贷款还款${result.loanRepaymentAmount ? `（¥${result.loanRepaymentAmount.toFixed(2)}）` : ""}`
        : "";
      setImportMessage(`已导入 ${result.imported} 笔，跳过 ${result.skipped} 笔，失败 ${result.errors} 笔${repaymentSummary}${result.errors ? "，失败行可再次确认导入" : ""}`);
      if (result.imported) window.dispatchEvent(new Event("stark:transaction-saved"));
      if (result.loanRepayments) window.dispatchEvent(new Event("stark:loan-saved"));
      if (result.errors > 0) {
        const now = nowText();
        const failedRows: ImportFailedRow[] = result.failedRows?.length
          ? result.failedRows
          : [{ lineNumber: 0, rawData: `${pendingBillImport.transactions.length} rows`, errorMessage: `${result.errors} rows failed to import`, errorType: "IMPORT" }];
        const failedLogs: ImportErrorLog[] = buildImportErrorLogs(failedRows, { fileName: pendingBillImport.fileName, accountId: getCurrentAccountId(), createdAt: now });
        setImportErrors((current) => [...failedLogs, ...current]);
        void saveImportLogsInBackground(repository, failedLogs).catch(() => undefined);
        if (result.failedRows?.length) {
          const failedTransactions = selectFailedImportTransactions(pendingBillImport.transactions, result.failedRows);
          if (failedTransactions.length) setPendingBillImport({ ...pendingBillImport, transactions: failedTransactions });
        }
      }
      if (!result.errors) {
        const resolvedLogs = importErrors
          .filter((item) => item.fileName === pendingBillImport.fileName && !item.resolved)
          .map((item) => ({ ...item, resolved: true }));
        if (resolvedLogs.length) {
          void saveImportLogsInBackground(repository, resolvedLogs).catch(() => undefined);
          const resolvedIds = new Map(resolvedLogs.map((log) => [log.id, log]));
          setImportErrors((current) => current.map((item) => resolvedIds.get(item.id) ?? item));
        }
        setPendingBillImport(null);
      }
    } catch (error) {
      setImportInterrupted(true);
      setImportMessage(`导入中断，已确认处理 ${completed}/${total} 笔：${importFailureReason(error)}。请直接点击“继续导入”，已写入的账单会自动跳过。`);
      window.dispatchEvent(new Event("stark:transaction-saved"));
      window.dispatchEvent(new Event("stark:loan-saved"));
    } finally {
      setImporting(false);
    }
  }

  async function exportLedgerData() {
    if (exporting) return;
    setExporting(true);
    setExportMessage("正在整理当前账本数据...");
    try {
      const repository = manager.getRepository();
      const accountId = getCurrentAccountId();
      const pageSize = 500;
      const transactions: Transaction[] = [];
      for (let page = 1; ; page += 1) {
        const batch = await repository.getTransactions(accountId, page, pageSize);
        transactions.push(...batch);
        setExportMessage(`正在读取账单，已读取 ${transactions.length} 笔...`);
        if (batch.length < pageSize) {
          break;
        }
      }
      setExportMessage("正在读取资产、预算和储蓄等账本数据...");
      const [account, assets, budgets, loans, savingsGoals, categoryRules, subscriptions, importErrorLogs, exchangeRates] = await Promise.all([
        repository.getAccount(accountId),
        repository.getAssets(accountId),
        repository.getBudgets(accountId),
        repository.getLoans(accountId),
        repository.getSavingsGoals(accountId),
        repository.getCategoryRules(accountId),
        repository.getSubscriptions(accountId),
        repository.getImportErrorLogs(accountId),
        repository.getExchangeRates(),
      ]);
      if (!account) throw new Error("无法读取当前账本，请重试");
      const [savingsPlans, themeConfig] = await Promise.all([
        repository.getSavingsPlansByGoals(savingsGoals.map((goal) => goal.id)),
        repository.getThemeConfig(cloudUser?.id ?? account.ownerId),
      ]);
      const exported = serializeAccountArchiveToJson(account, {
        transactions,
        assets,
        budgets,
        loans,
        savingsGoals,
        savingsPlans,
        subscriptions,
        categoryRules,
        importErrorLogs,
        exchangeRates,
        themeConfig,
      });
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const fileName = `star-accounting-ledger-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
      if (Capacitor.isNativePlatform()) {
        setExportMessage("正在保存账本数据到系统文件...");
        const result = await saveExportFileOnAndroid(exported.content, fileName, "application/json", (percent) => setExportMessage(`正在保存账本数据... ${percent}%`));
        setExportMessage(`已导出当前账本全部业务数据，共 ${exported.totalRecordCount} 条记录，保存位置：${result.location}`);
        return;
      }
      const blob = new Blob([exported.content], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportMessage(`已导出当前账本全部业务数据，共 ${exported.totalRecordCount} 条记录，请在浏览器下载记录中查看 ${fileName}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      if (detail === "已取消保存") {
        setExportMessage("已取消导出");
      } else if (Capacitor.isNativePlatform() && /not implemented/i.test(detail)) {
        setExportMessage("当前安装包尚未包含账本数据导出功能，请安装新版本后再导出");
      } else {
        setExportMessage(`导出账本数据失败${detail ? `：${detail}` : ""}`);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page-stack settings-center-page">
      <PageTopBar title="设置" />

      <section className="settings-center-group">
        <SettingsRow type="IMPORT" title="导入账单" value="微信 / 支付宝" onClick={() => setActivePanel("IMPORT")} />
        <SettingsRow type="EXPORT" title="导出账本数据" value="JSON 文件" onClick={() => { setExportMessage("将导出当前账本的完整业务数据为 JSON 文件"); setActivePanel("EXPORT"); }} />
      </section>

      <section className="settings-center-group">
        <SettingsRow type="REMARK" title="账单归类" value="转账可归入支出分类" onClick={() => setActivePanel("REMARK")} />
        <SettingsRow type="SUBSCRIPTIONS" title="订阅/扣费管理" value="按月自动记账" onClick={() => setActivePanel("SUBSCRIPTIONS")} />
        <SettingsRow
          type="BALANCE"
          title="余额基准"
          value={ledgerAccountStatus === "loading"
            ? "读取中"
            : ledgerAccountStatus === "error"
              ? "读取失败"
              : ledgerAccount?.openingBalanceDate && ledgerAccount.openingBalance != null
                ? `已设置 · ${ledgerAccount.openingBalanceDate.slice(0, 10)} · ¥${Number(ledgerAccount.openingBalance).toFixed(2)}`
                : "未设置"}
          onClick={() => setActivePanel("BALANCE")}
        />
        <SettingsRow type="AI_VISION" title="AI 截图识别" value={cloudUser ? "配置截图识别模型" : "需云端账户"} onClick={() => setActivePanel("AI_VISION")} />
        {isAndroidApp ? <SettingsRow type="FLOATING" title="悬浮记账" value="点击后直接记账" onClick={() => setActivePanel("FLOATING")} /> : null}
      </section>

      <section className="settings-center-group">
        <SettingsRow type="LANGUAGE" title="语言" value={languageLabels[uiSettings.language]} onClick={() => setActivePanel("LANGUAGE")} />
        <SettingsRow type="FONT" title="字体大小" value={fontLabels[uiSettings.font]} onClick={() => setActivePanel("FONT")} />
        {mode === "CLOUD" && cloudUser ? <SettingsRow type="ACCOUNT" title="账户设置" value="密码与注册" onClick={openAccountSettings} /> : null}
      </section>

      <section className="settings-center-group">
        <SettingsRow type="HELP" title="帮助与反馈" onClick={() => setActivePanel("HELP")} />
        <SettingsRow type="UPDATE" title="检查更新" value={`v${packageInfo.version}`} updateAvailable={updateAvailable} onClick={() => window.dispatchEvent(new Event("stark:check-app-update"))} />
        <SettingsRow type="ABOUT" title="关于" value={`v${packageInfo.version}`} onClick={() => setActivePanel("ABOUT")} />
      </section>

      {mode === "LOCAL" ? (
        <section className="settings-center-group">
          <SettingsRow type="MODE" title="切换数据模式" value="当前：本地模式" onClick={openModeSwitch} />
        </section>
      ) : null}

      {mode === "CLOUD" && cloudUser ? <button type="button" className="settings-logout-button" onClick={requestLogout}>退出登录</button> : null}

      {logoutConfirmOpen ? (
        <div className="account-confirm-mask" role="presentation" onClick={closeLogoutConfirm}>
          <section className="account-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="account-logout-title" onClick={(event) => event.stopPropagation()}>
            <strong id="account-logout-title">确定要退出当前云端账户吗？</strong>
            <div className="account-confirm-actions">
              <button type="button" className="account-confirm-cancel" onClick={closeLogoutConfirm}>取消</button>
              <button type="button" className="account-confirm-primary" onClick={logout}>确定</button>
            </div>
          </section>
        </div>
      ) : null}

      {activePanel ? (
        <BottomSheet
          title={activePanel === "ACCOUNT" ? "账户设置" : activePanel === "IMPORT" ? "导入账单" : activePanel === "EXPORT" ? "导出账本数据" : activePanel === "REMARK" ? "账单归类" : activePanel === "BALANCE" ? "余额基准" : activePanel === "SUBSCRIPTIONS" ? "订阅/扣费管理" : activePanel === "AI_VISION" ? "AI 截图识别" : activePanel === "FLOATING" ? "悬浮记账" : activePanel === "LANGUAGE" ? "语言" : activePanel === "FONT" ? "字体大小" : activePanel === "HELP" ? "帮助与反馈" : "关于"}
          className="settings-sheet"
          overlayClassName="settings-sheet-overlay"
          onClose={() => setActivePanel(null)}
        >

            {activePanel === "ACCOUNT" ? <div className="settings-sheet-body account-settings-sheet">
              <section className="account-settings-section">
                <div><strong>修改密码</strong><p>当前已登录云端账户，新密码至少需要 8 位。</p></div>
                <label className="settings-url-field"><span>新密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="请输入新密码" autoComplete="new-password" /></label>
                <label className="settings-url-field"><span>确认新密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="请再次输入新密码" autoComplete="new-password" /></label>
                {passwordError ? <div className="cloud-test-status error">{passwordError}</div> : null}
                {passwordMessage ? <div className="cloud-test-status success">{passwordMessage}</div> : null}
                <button type="button" className="settings-confirm-button account-settings-primary" disabled={passwordSubmitting} onClick={() => void submitPasswordReset()}>{passwordSubmitting ? "提交中..." : "确认修改密码"}</button>
              </section>
              <section className="account-settings-section account-settings-registration">
                <div><strong>新用户注册</strong><p>{registrationLoading ? "正在读取注册状态..." : registrationEnabled ? "当前允许新用户注册。" : "当前已关闭新用户注册。"}</p></div>
                <label className="settings-url-field"><span>管理员恢复密钥</span><input type="text" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} placeholder="仅用于本次操作，不会保存" autoComplete="off" /></label>
                {registrationError ? <div className="cloud-test-status error">{registrationError}</div> : null}
                {registrationMessage ? <div className="cloud-test-status success">{registrationMessage}</div> : null}
                <button type="button" className={`account-registration-button${registrationEnabled ? " close" : ""}`} disabled={registrationLoading || registrationSubmitting} onClick={() => void submitRegistrationChange()}>{registrationSubmitting ? "提交中..." : registrationEnabled ? "关闭新用户注册" : "开启新用户注册"}</button>
              </section>
            </div> : null}

            {activePanel === "IMPORT" ? <div className="settings-sheet-body">
              <div className="bill-platform-picker">
                <button type="button" className={importPlatform === "微信" ? "active wechat" : "wechat"} onClick={() => selectImportPlatform("微信")}><span><img src={withAppBasePath("/category-icons/weixin.webp")} alt="" /></span><div><strong>微信账单</strong><small>微信支付 CSV / Excel 格式</small></div></button>
                <button type="button" className={importPlatform === "支付宝" ? "active alipay" : "alipay"} onClick={() => selectImportPlatform("支付宝")}><span><img src={withAppBasePath("/category-icons/zhifubao.webp")} alt="" /></span><div><strong>支付宝账单</strong><small>支付宝交易记录 CSV / Excel</small></div></button>
                <button type="button" className={importPlatform === "本应用导出" ? "active backup" : "backup"} onClick={() => selectImportPlatform("本应用导出")}><span><img src={withAppBasePath("/icon.svg")} alt="" /></span><div><strong>本应用导出账单</strong><small>本应用导出的 CSV 流水</small></div></button>
              </div>
              <div className={`bill-import-message ${importMessage.startsWith("已导入") ? "success" : ""}`}>{importMessage}</div>
              <input ref={fileInputRef} type="file" hidden accept={importPlatform === "本应用导出" ? ".csv,text/csv" : ".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void prepareBillImport(file); }} />
              <button type="button" className="settings-sheet-primary" disabled={readingBill || importing} onClick={() => fileInputRef.current?.click()}>{readingBill ? "正在读取..." : pendingBillImport ? "重新选择账单文件" : "选择账单文件"}</button>
              {pendingBillImport ? <button type="button" className="settings-confirm-button bill-import-confirm" disabled={importing} onClick={() => void confirmBillImport()}>{importing ? "导入中..." : importInterrupted ? `继续导入 ${pendingBillImport.transactions.length} 笔` : `确认导入 ${pendingBillImport.transactions.length} 笔`}</button> : null}
              <p className="settings-sheet-tip">支持微信、支付宝官方导出的 CSV / XLS / XLSX 文件，以及本应用导出的 CSV 流水。导入本应用 CSV 时只读取收入、支出、转账和还款记录；储蓄操作行不会被当作账单导入。</p>
              {importErrors.length ? <div className="import-error-list"><strong>最近导入问题</strong>{importErrors.slice(0, 5).map((item) => <div key={item.id}><span>{item.fileName}{item.lineNumber > 0 ? ` · 第 ${item.lineNumber} 行` : ""}</span><small>{item.resolved ? "已解决" : item.errorMessage}</small></div>)}</div> : null}
            </div> : null}

            {activePanel === "EXPORT" ? <div className="settings-sheet-body">
              <p className="settings-sheet-note">导出当前账本完整业务数据为 JSON，包括全部账单流水、资产余额、预算、贷款、储蓄目标和计划、周期扣费、账单归类规则、导入问题记录及余额基准；汇率参考、主题配置、储蓄凭证和资金池明细也会保留。不会导出其他账本、登录密码、认证令牌或 API 密钥。此文件用于数据归档；上方的账单导入功能目前仍读取 CSV 流水。</p>
              <div className="bill-import-message">{exportMessage}</div>
              <button type="button" className="settings-sheet-primary" disabled={exporting} onClick={() => void exportLedgerData()}>{exporting ? "正在导出..." : "导出完整账本数据"}</button>
              <p className="settings-sheet-tip">文件采用 UTF-8 JSON 格式，包含导出时间、账本信息、各类数据和记录数量。Android 单文件上限为 100MB，超限会报错，不会静默导出部分数据。</p>
            </div> : null}

            {activePanel === "REMARK" ? <div className="settings-sheet-body remark-sheet-body">
              <BillRemarkSheet />
            </div> : null}

            {activePanel === "BALANCE" ? <AccountReconciliationSheet /> : null}

            {activePanel === "SUBSCRIPTIONS" ? <SubscriptionManagementSheet /> : null}

            {activePanel === "AI_VISION" ? <AIVisionSettingsSheet enabled={Boolean(cloudUser)} onOpenCloudLogin={openModeSwitch} /> : null}

            {activePanel === "FLOATING" ? <FloatingJournalSettings /> : null}

            {activePanel === "LANGUAGE" ? <div className="settings-option-list">{(["SYSTEM", "ZH_CN", "EN_US"] as LanguageChoice[]).map((item) => <button type="button" key={item} className={uiSettings.language === item ? "active" : ""} onClick={() => updateUiSetting("language", item)}><span><strong>{languageLabels[item]}</strong><small>{item === "SYSTEM" ? "使用设备的语言偏好" : item === "ZH_CN" ? "固定使用简体中文" : "固定使用英文"}</small></span><em>{uiSettings.language === item ? "✓" : ""}</em></button>)}</div> : null}
            {activePanel === "FONT" ? <div className="settings-font-options">{(["SMALL", "STANDARD", "LARGE"] as FontChoice[]).map((item) => <button type="button" key={item} className={uiSettings.font === item ? "active" : ""} onClick={() => updateUiSetting("font", item)}><span style={{ fontSize: item === "SMALL" ? 13 : item === "LARGE" ? 19 : 16 }}>Aa</span><strong>{fontLabels[item]}</strong></button>)}</div> : null}
            {activePanel === "HELP" ? <div className="settings-sheet-body help-sheet-body"><div><strong>数据没有加载出来怎么办？</strong><p>请返回根登录入口确认云端服务与数据库状态，再重新登录。</p></div><div><strong>账单导入支持什么格式？</strong><p>支持微信和支付宝官方导出的 CSV、XLS、XLSX 文件，也支持本应用导出的 CSV 账单。</p></div><div><strong>Web 端和 App 有何不同？</strong><p>目前暂时只开发安卓客户端，Web 端适用于 PC、iOS、鸿蒙等设备。</p></div><a href="https://github.com/wottyup/star-accounting/issues" target="_blank" rel="noreferrer">国际站点端反馈 <ChevronIcon /></a><a href="https://sevencn.com/software/staraccounting" target="_blank" rel="noreferrer">国内站点端反馈 <ChevronIcon /></a></div> : null}
            {activePanel === "ABOUT" ? <div className="settings-about">
              <span><img src={withAppBasePath("/icon.svg")} alt="" /></span>
              <strong>星会计</strong>
              <p>版本 {packageInfo.version}</p>
              <small>本地优先、可连接云端的个人财务管理工具</small>
              <div>Next.js · Capacitor · Kotlin</div>
              <nav className="settings-about-links" aria-label="相关网站">
                <a href="https://sevencn.com" target="_blank" rel="noreferrer"><span className="settings-about-link-copy"><strong>博客</strong><span className="settings-about-link-url">sevencn.com</span></span><ChevronIcon /></a>
                <a href="https://s.wotty.app" target="_blank" rel="noreferrer"><span className="settings-about-link-copy"><strong>项目网站</strong><span className="settings-about-link-url">s.wotty.app</span></span><ChevronIcon /></a>
                <a href="https://github.com/wottyup/star-accounting" target="_blank" rel="noreferrer"><span className="settings-about-link-copy"><strong>开源地址</strong><span className="settings-about-link-url">github.com/wottyup/star-accounting</span></span><ChevronIcon /></a>
              </nav>
              <blockquote className="settings-about-verse" lang="zh-CN">
                星点毫厘入小屏，<br />会收云本地双清，<br />计来出入自分明——心安。
              </blockquote>
            </div> : null}
        </BottomSheet>
      ) : null}
    </div>
  );
}
