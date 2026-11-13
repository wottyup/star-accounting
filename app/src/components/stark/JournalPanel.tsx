"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import { DataModeManager } from "@/lib/stark/repository/DataModeManager";
import { nowText } from "@/lib/stark/utils/format";
import { createId } from "@/lib/stark/utils/id";
import { clearNewEntryDraft, readNewEntryDraft, saveNewEntryDraft, type NewEntryDraftKind } from "@/lib/stark/storage/new-entry-drafts";
import { getCloudApiUrl, getCurrentAccountId } from "@/lib/stark/storage/local-config";
import { getCloudAuthToken } from "@/lib/stark/storage/cloud-auth";
import { SHOWCASE_DEMO_MODE } from "@/lib/stark/runtime";
import { recordSavingsPlanDeposit } from "@/lib/stark/savings/planner";
import { buildSalaryBatchTransactions, SALARY_BATCH_MONTHS, salaryBatchMonthKeys, selectSalaryBatchMonths } from "@/lib/stark/journal/salary-batch";
import type { Asset, AssetType, Loan, SavingsGoal, SavingsPlan, Transaction, TransactionType } from "@/lib/stark/models";
import { categoryIconSrcForCategory, expenseCategoryOptions } from "@/lib/stark/utils/category-icon";
import { DateTimePicker } from "@/components/stark/DateTimePicker";
import { ProofImageViewer } from "@/components/stark/ProofImageViewer";
import { useLayeredHistoryMarker } from "@/components/stark/useLayeredHistoryMarker";
import { useSheetPresentation } from "@/components/stark/useSheetPresentation";
import { JournalActionDock, JournalActionTargetContext } from "@/components/stark/JournalActionDock";
import { translateText, useAppLocale } from "@/lib/stark/i18n";

const SavingsPlanner = dynamic(
  () => import("@/components/stark/SavingsPlanner").then((module) => module.SavingsPlanner),
  { ssr: false },
);

const repo = new DataModeManager().getRepository();

const expenseCategories = expenseCategoryOptions;
const incomeCategories = ["工资", "奖金", "兼职", "经营收入", "报销", "退款", "租金", "利息分红", "补贴", "二手转卖", "理财", "其他"];
const transferCategories = ["转账"];
const platforms = ["支付宝", "微信", "银行卡", "现金", "其他"];
const identifiablePaymentPlatforms = ["支付宝", "微信", "银行卡", "现金"];
const assetTypes: AssetType[] = ["CASH", "BANK_CARD", "ALIPAY", "WECHAT", "INVESTMENT", "OTHER"];
const assetTypeLabels: Record<AssetType, string> = {
  CASH: "现金",
  BANK_CARD: "银行卡",
  ALIPAY: "支付宝",
  WECHAT: "微信",
  INVESTMENT: "投资",
  OTHER: "其他",
};

type JournalDraft = {
  id?: string;
  type: TransactionType;
  amount: string;
  category: string;
  platform: string;
  shoppingPlatform?: string;
  merchant: string;
  description: string;
  date: string;
  confidence?: string;
  warnings?: string[];
  recognizedDrafts?: JournalDraft[];
  activeRecognizedDraftIndex?: number;
};

type AssetDraft = {
  assetName: string;
  assetBalance: string;
  assetType: AssetType;
};

type LoanDraft = {
  loanPlatform: string;
  loanMatchKeywords: string;
  loanTotalAmount: string;
  loanRemainingAmount: string;
  loanMonthlyPayment: string;
  loanPeriods: string;
  loanDueDay: string;
};

type KeyboardViewport = {
  height: number;
  offsetTop: number;
};

export type JournalPanelProps = {
  onClose: () => void;
  onSaved?: () => void;
  mode?: "sheet" | "page";
  historyMode?: "marker" | "route";
  variant?: "journal" | "savings" | "savings-record" | "asset" | "loan" | "repayment";
  preset?: { type: TransactionType; category: string };
  savingsGoalId?: string;
  savingsPlan?: SavingsPlan;
  savingsGoal?: SavingsGoal;
  transaction?: Transaction;
  floatingOverlay?: boolean;
  asset?: Asset;
  loan?: Loan;
};

export function JournalPanel({
  onClose,
  onSaved,
  mode = "sheet",
  historyMode = "marker",
  variant = "journal",
  preset,
  savingsGoalId,
  savingsPlan,
  savingsGoal,
  transaction,
  floatingOverlay = false,
  asset,
  loan,
}: JournalPanelProps) {
  const isPage = mode === "page";
  const isSavings = variant === "savings";
  const isSavingsRecord = variant === "savings-record";
  const isEditingSavings = isSavings && Boolean(savingsGoalId);
  const isAsset = variant === "asset";
  const isLoan = variant === "loan";
  const isRepayment = variant === "repayment";
  const isEditingTransaction = Boolean(transaction);
  const isEditingAsset = isAsset && Boolean(asset);
  const isEditingLoan = isLoan && Boolean(loan);
  const isEditingEntity = isEditingTransaction || isEditingAsset || isEditingLoan || isRepayment;
  const locale = useAppLocale();
  const isSalaryPreset = variant === "journal" && preset?.type === "INCOME" && preset.category === "工资";
  const draftKind: NewEntryDraftKind = isSavings ? "savings" : isAsset ? "asset" : isLoan ? "loan" : isSalaryPreset ? "salary" : "journal";
  const [visible, setVisible] = useState(false);
  const nativeSheetReady = useSheetPresentation(!floatingOverlay);
  const sheetReady = floatingOverlay || nativeSheetReady;
  const [type, setType] = useState<TransactionType>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("餐饮");
  const [platform, setPlatform] = useState("支付宝");
  const [shoppingPlatform, setShoppingPlatform] = useState("");
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(nowText().slice(0, 16));
  const [assetName, setAssetName] = useState("");
  const [assetBalance, setAssetBalance] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("ALIPAY");
  const [loanPlatform, setLoanPlatform] = useState("");
  const [loanMatchKeywords, setLoanMatchKeywords] = useState("");
  const [loanTotalAmount, setLoanTotalAmount] = useState("");
  const [loanRemainingAmount, setLoanRemainingAmount] = useState("");
  const [loanMonthlyPayment, setLoanMonthlyPayment] = useState("");
  const [loanPeriods, setLoanPeriods] = useState("12");
  const [loanDueDay, setLoanDueDay] = useState("20");
  const [recordedAmount, setRecordedAmount] = useState("");
  const [recordedDate, setRecordedDate] = useState(nowText().slice(0, 16));
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [previewProofImage, setPreviewProofImage] = useState<string | null>(null);
  const [screenshotRecognitionBusy, setScreenshotRecognitionBusy] = useState(false);
  const [screenshotRecognitionNotice, setScreenshotRecognitionNotice] = useState("");
  const [recognizedDrafts, setRecognizedDrafts] = useState<JournalDraft[]>([]);
  const [activeRecognizedDraftIndex, setActiveRecognizedDraftIndex] = useState(0);
  const [transactionSaving, setTransactionSaving] = useState(false);
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordNotice, setRecordNotice] = useState("");
  const [salaryEntryMode, setSalaryEntryMode] = useState<"single" | "batch">("single");
  const [salaryEntryOpen, setSalaryEntryOpen] = useState(isSalaryPreset);
  const [batchYear, setBatchYear] = useState(String(new Date().getFullYear()));
  const [batchMonths, setBatchMonths] = useState<number[]>([]);
  const [batchAmount, setBatchAmount] = useState("");
  const [batchPayday, setBatchPayday] = useState("15");
  const [batchMerchant, setBatchMerchant] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchNotice, setBatchNotice] = useState("");
  const proofImageInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotRecognitionInputRef = useRef<HTMLInputElement | null>(null);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const draftSubmittedRef = useRef(false);
  const [keyboardViewport, setKeyboardViewport] = useState<KeyboardViewport | null>(null);
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);

  const categories = useMemo((): string[] => {
    if (type === "INCOME") return incomeCategories;
    if (type === "TRANSFER") return transferCategories;
    return expenseCategories;
  }, [type]);
  const isBatchRecognition = recognizedDrafts.length > 1;

  useEffect(() => {
    if (transaction) {
      setType(transaction.type);
      setAmount(String(transaction.amount));
      setCategory(transaction.category);
      setPlatform(transaction.platform);
      setShoppingPlatform(transaction.shoppingPlatform ?? "");
      setMerchant(transaction.merchant ?? "");
      setDescription(transaction.description ?? "");
      setDate(transaction.date.slice(0, 16));
    }
    if (asset) {
      setAssetName(asset.name);
      setAssetBalance(String(asset.balance));
      setAssetType(asset.type);
    }
    if (loan) {
      setLoanPlatform(loan.platform);
      setLoanMatchKeywords(loan.matchKeywords ?? "");
      setLoanTotalAmount(String(loan.totalAmount));
      setLoanRemainingAmount(String(loan.remainingAmount));
      setLoanMonthlyPayment(String(loan.monthlyPayment));
      setLoanPeriods(String(loan.periods));
      setLoanDueDay(String(loan.dueDate));
    }
    if (isRepayment && loan) {
      setType("REPAYMENT");
      setCategory("还款");
      setPlatform(loan.platform);
      setAmount(String(loan.monthlyPayment || ""));
      setDate(nowText().slice(0, 16));
    }
  }, [asset, isRepayment, loan, transaction]);

  useEffect(() => {
    if (type === "TRANSFER") setCategory("转账");
    if (type !== "TRANSFER" && category === "转账") setCategory(type === "INCOME" ? "工资" : "餐饮");
    if (type === "INCOME" && !incomeCategories.includes(category)) setCategory("工资");
    if (type === "EXPENSE" && !expenseCategories.includes(category)) setCategory("餐饮");
  }, [type, category]);

  useEffect(() => {
    if (!preset || variant !== "journal") return;
    setType(preset.type);
    setCategory(preset.category);
  }, [preset, variant]);

  useEffect(() => {
    setDraftReady(false);
    draftSubmittedRef.current = false;
    if (isEditingEntity) {
      setDraftReady(true);
      return;
    }
    if (draftKind === "asset") {
      const draft = readNewEntryDraft<AssetDraft>(draftKind);
      if (draft) {
        setAssetName(draft.assetName);
        setAssetBalance(draft.assetBalance);
        setAssetType(draft.assetType);
      }
    } else if (draftKind === "loan") {
      const draft = readNewEntryDraft<LoanDraft>(draftKind);
      if (draft) {
        setLoanPlatform(draft.loanPlatform);
        setLoanMatchKeywords(draft.loanMatchKeywords ?? "");
        setLoanTotalAmount(draft.loanTotalAmount);
        setLoanRemainingAmount(draft.loanRemainingAmount);
        setLoanMonthlyPayment(draft.loanMonthlyPayment);
        setLoanPeriods(draft.loanPeriods);
        setLoanDueDay(draft.loanDueDay);
      }
    } else if (draftKind === "journal" || draftKind === "salary") {
      const draft = readNewEntryDraft<JournalDraft>(draftKind);
      if (draft) {
        setType(draft.type);
        setAmount(draft.amount);
        setCategory(draft.category);
        setPlatform(draft.platform);
        setShoppingPlatform(draft.shoppingPlatform ?? "");
        setMerchant(draft.merchant);
        setDescription(draft.description);
        setDate(draft.date);
        if (Array.isArray(draft.recognizedDrafts)) {
          const recognizedDrafts = draft.recognizedDrafts.filter((item) => (
            item && typeof item.amount === "string" && typeof item.merchant === "string" && typeof item.description === "string"
          ));
          setRecognizedDrafts(recognizedDrafts);
          setActiveRecognizedDraftIndex(Math.min(
            Math.max(0, draft.activeRecognizedDraftIndex ?? 0),
            Math.max(0, recognizedDrafts.length - 1),
          ));
        }
      }
    }
    setDraftReady(true);
  }, [draftKind, isEditingEntity]);

  useEffect(() => {
    if (!isSavingsRecord || !savingsPlan) return;
    setRecordedAmount(String(savingsPlan.actualAmount ?? savingsPlan.amount ?? ""));
    setRecordedDate((savingsPlan.actualDate ?? savingsPlan.updatedAt ?? nowText()).slice(0, 16));
    setProofImage(savingsPlan.proofImage ?? null);
    setRecordNotice("");
  }, [isSavingsRecord, savingsPlan]);

  useEffect(() => {
    if (!draftReady || isSavings || isSavingsRecord || isEditingEntity || draftSubmittedRef.current) return;
    if (draftKind === "asset") {
      saveNewEntryDraft(draftKind, { assetName, assetBalance, assetType } satisfies AssetDraft);
    } else if (draftKind === "loan") {
      saveNewEntryDraft(draftKind, { loanPlatform, loanMatchKeywords, loanTotalAmount, loanRemainingAmount, loanMonthlyPayment, loanPeriods, loanDueDay } satisfies LoanDraft);
    } else {
      const activeDraft = recognizedDrafts[activeRecognizedDraftIndex] ?? {
        type,
        amount,
        category,
        platform,
        shoppingPlatform,
        merchant,
        description,
        date,
      };
      const currentRecognizedDraft: JournalDraft = recognizedDrafts.length > 1
        ? { ...activeDraft, type, category, platform, shoppingPlatform, date }
        : { ...activeDraft, type, amount, category, platform, shoppingPlatform, merchant, description, date };
      const savedRecognizedDrafts = recognizedDrafts.length > 0
        ? recognizedDrafts.map((draft, index) => index === activeRecognizedDraftIndex ? currentRecognizedDraft : draft)
        : [];
      saveNewEntryDraft(draftKind, {
        type,
        amount,
        category,
        platform,
        shoppingPlatform,
        merchant,
        description,
        date,
        recognizedDrafts: savedRecognizedDrafts,
        activeRecognizedDraftIndex,
      } satisfies JournalDraft);
    }
  }, [activeRecognizedDraftIndex, assetBalance, assetName, assetType, date, description, draftKind, draftReady, isEditingEntity, isSavings, loanDueDay, loanMatchKeywords, loanMonthlyPayment, loanPeriods, loanPlatform, loanRemainingAmount, loanTotalAmount, amount, category, merchant, platform, recognizedDrafts, shoppingPlatform, type]);

  useEffect(() => {
    if (sheetReady && !closingRef.current) setVisible(true);
  }, [sheetReady]);

  useEffect(() => {
    if (!floatingOverlay || !sheetReady || !visible) return;
    window.AndroidFloatingJournal?.onFormReady();
  }, [floatingOverlay, sheetReady, visible]);

  useEffect(() => {
    if (!window.visualViewport) return;
    const viewport = window.visualViewport;
    const updateKeyboardViewport = () => {
      const keyboardOpen = viewport.height < window.innerHeight - 120;
      setKeyboardViewport(keyboardOpen
        ? { height: Math.round(viewport.height), offsetTop: Math.round(viewport.offsetTop) }
        : null);
    };
    updateKeyboardViewport();
    viewport.addEventListener("resize", updateKeyboardViewport);
    viewport.addEventListener("scroll", updateKeyboardViewport);
    return () => {
      viewport.removeEventListener("resize", updateKeyboardViewport);
      viewport.removeEventListener("scroll", updateKeyboardViewport);
    };
  }, []);

  useEffect(() => {
    if (!isPage) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const original = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = original.position;
      body.style.top = original.top;
      body.style.width = original.width;
      body.style.overflow = original.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [isPage]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const beginClose = useCallback(() => {
    if (closingRef.current) return;
    if (isSavings) window.sessionStorage.removeItem(SHOWCASE_DEMO_MODE ? "showcase:stark:journal-variant" : "stark:journal-variant");
    closingRef.current = true;
    setVisible(false);
    closeTimerRef.current = setTimeout(onClose, floatingOverlay ? 0 : 220);
  }, [floatingOverlay, isSavings, onClose]);
  const consumeHistoryEntry = useLayeredHistoryMarker(historyMode === "marker", "starkJournalPanel", beginClose);
  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    consumeHistoryEntry();
    beginClose();
  }, [beginClose, consumeHistoryEntry]);

  const keyboardViewportStyle: CSSProperties | undefined = keyboardViewport
    ? {
        height: `${keyboardViewport.height}px`,
        top: `${keyboardViewport.offsetTop}px`,
        bottom: "auto",
      }
    : undefined;

  const touchStart = useRef({ x: 0, y: 0, allowClose: false, outsidePanel: false, edge: "" as "left" | "right" | "" });
  const panelRef = useRef<HTMLDivElement | null>(null);
  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    const panel = panelRef.current;
    const insidePanel = Boolean(panel?.contains(e.target as Node));
    const panelBounds = panel?.getBoundingClientRect();
    const panelTop = panelBounds?.top ?? 0;
    // 标题栏保留横滑返回；悬浮卡片只在左右边缘识别内滑，避免误关横向内容区。
    const inTopHeaderRegion = insidePanel && touch.clientY <= panelTop + 50;
    const edgeSwipe = insidePanel && floatingOverlay && panelBounds
      ? touch.clientX - panelBounds.left <= 24
        ? "left"
        : panelBounds.right - touch.clientX <= 24
          ? "right"
          : ""
      : "";
    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      allowClose: inTopHeaderRegion || Boolean(edgeSwipe),
      outsidePanel: !insidePanel,
      edge: edgeSwipe,
    };
  }
  function handleTouchMove(e: React.TouchEvent) {
    const start = touchStart.current;
    if (!isPage || (!start.outsidePanel && !start.edge)) return;
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const isHorizontal = Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15;
    if (isHorizontal) e.preventDefault();
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    if (!start.allowClose) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const isHorizontal = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.25;
    const swipedInwardFromEdge = start.edge === "left"
      ? dx > 60
      : start.edge === "right"
        ? dx < -60
        : true;
    if (isHorizontal && swipedInwardFromEdge) handleClose();
  }

  function currentJournalDraft(): JournalDraft {
    const activeDraft = recognizedDrafts[activeRecognizedDraftIndex] ?? {};
    if (recognizedDrafts.length > 1) {
      return { ...activeDraft, type, category, platform, shoppingPlatform, date } as JournalDraft;
    }
    return { ...activeDraft, type, amount, category, platform, shoppingPlatform, merchant, description, date } as JournalDraft;
  }

  function applyJournalDraft(draft: JournalDraft) {
    setType(draft.type);
    setAmount(draft.amount);
    setCategory(draft.category);
    setPlatform(draft.platform);
    setShoppingPlatform(draft.shoppingPlatform ?? "");
    setMerchant(draft.merchant);
    setDescription(draft.description);
    setDate(draft.date);
  }

  function selectRecognizedDraft(index: number) {
    if (index < 0 || index >= recognizedDrafts.length || index === activeRecognizedDraftIndex) return;
    const drafts = recognizedDrafts.map((draft, draftIndex) => draftIndex === activeRecognizedDraftIndex ? currentJournalDraft() : draft);
    setRecognizedDrafts(drafts);
    setActiveRecognizedDraftIndex(index);
    if (drafts.length <= 1) applyJournalDraft(drafts[index]);
  }

  function updateRecognizedDraft(index: number, changes: Partial<Pick<JournalDraft, "amount" | "merchant" | "description">>) {
    setRecognizedDrafts((drafts) => drafts.map((draft, draftIndex) => (
      draftIndex === index
        ? {
          ...draft,
          ...changes,
          warnings: changes.amount && Number(changes.amount) > 0
            ? draft.warnings?.filter((warning) => !warning.includes("没有识别出金额") && !warning.includes("amount was not recognized"))
            : draft.warnings,
        }
        : draft
    )));
  }

  function removeRecognizedDraft(index: number) {
    const wasBatchMode = recognizedDrafts.length > 1;
    const drafts = recognizedDrafts.map((draft, draftIndex) => draftIndex === activeRecognizedDraftIndex ? currentJournalDraft() : draft);
    const remaining = drafts.filter((_, draftIndex) => draftIndex !== index);
    setRecognizedDrafts(remaining);
    if (remaining.length === 0) {
      setActiveRecognizedDraftIndex(0);
      setAmount("");
      setCategory("餐饮");
      setPlatform("其他");
      setShoppingPlatform("");
      setMerchant("");
      setDescription("");
      setDate(nowText().slice(0, 16));
      setScreenshotRecognitionNotice(translateText("已移除全部识别订单，可继续手动记账。", locale));
      return;
    }
    const nextIndex = index < activeRecognizedDraftIndex
      ? activeRecognizedDraftIndex - 1
      : index === activeRecognizedDraftIndex
        ? Math.min(index, remaining.length - 1)
        : activeRecognizedDraftIndex;
    setActiveRecognizedDraftIndex(nextIndex);
    if (remaining.length === 1) {
      applyJournalDraft(wasBatchMode
        ? { ...remaining[0], type, category, platform, shoppingPlatform, date }
        : remaining[0]);
    }
    setScreenshotRecognitionNotice(translateText("已移除这笔订单，剩余 {count} 笔。", locale).replace("{count}", String(remaining.length)));
  }

  async function saveTransaction() {
    if (transactionSaving) return;
    const drafts = recognizedDrafts.length > 0
      ? recognizedDrafts.map((draft, index) => index === activeRecognizedDraftIndex ? currentJournalDraft() : draft)
      : [currentJournalDraft()];
    const invalidIndex = drafts.findIndex((draft) => !Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0);
    if (invalidIndex >= 0) {
      setScreenshotRecognitionNotice(translateText("第 {number} 笔金额无效，请修改或移除。", locale).replace("{number}", String(invalidIndex + 1)));
      return;
    }

    setTransactionSaving(true);
    setScreenshotRecognitionNotice("");
    if (recognizedDrafts.length > 0) setRecognizedDrafts(drafts);
    try {
      const now = nowText();
      const batchMode = recognizedDrafts.length > 1;
      for (const [index, draft] of drafts.entries()) {
        const existingTransaction = transaction && (recognizedDrafts.length === 0 || index === 0)
          ? transaction
          : null;
        const entryDate = batchMode ? date : draft.date;
        await repo.saveTransaction({
          id: existingTransaction?.id ?? draft.id ?? createId("transaction"),
          userId: existingTransaction?.userId ?? "local-user",
          accountId: existingTransaction?.accountId ?? getCurrentAccountId(),
          amount: Number(draft.amount),
          type: batchMode ? type : draft.type,
          category: batchMode ? category : draft.category,
          platform: batchMode ? platform : draft.platform,
          shoppingPlatform: (batchMode ? type : draft.type) === "EXPENSE" ? shoppingPlatform.trim() || null : null,
          merchant: draft.merchant || null,
          date: entryDate.length === 16 ? `${entryDate}:00` : entryDate,
          description: draft.description || null,
          orderId: existingTransaction?.orderId ?? null,
          paymentMethod: existingTransaction?.paymentMethod ?? null,
          status: existingTransaction?.status ?? null,
          loanId: existingTransaction?.loanId ?? null,
          remarkCategory: existingTransaction?.remarkCategory ?? null,
          createdAt: existingTransaction?.createdAt ?? now,
          updatedAt: now,
        });
      }
      draftSubmittedRef.current = true;
      clearNewEntryDraft(draftKind);
      setRecognizedDrafts([]);
      setActiveRecognizedDraftIndex(0);
      setAmount("");
      setShoppingPlatform("");
      setMerchant("");
      setDescription("");
      setDate(nowText().slice(0, 16));
      if (type !== "TRANSFER") setCategory(type === "INCOME" ? "工资" : "餐饮");
      window.dispatchEvent(new Event("stark:transaction-saved"));
      onSaved?.();
      handleClose();
    } catch (error) {
      setScreenshotRecognitionNotice(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请稍后重试");
    } finally {
      setTransactionSaving(false);
    }
  }

  async function recognizeScreenshot(file: File | undefined) {
    if (screenshotRecognitionInputRef.current) screenshotRecognitionInputRef.current.value = "";
    if (!file) return;
    setScreenshotRecognitionNotice("");
    if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setScreenshotRecognitionNotice("仅支持 PNG、JPG 或 WebP 图片");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setScreenshotRecognitionNotice("图片超过 10 MiB，请压缩后重试");
      return;
    }
    const token = getCloudAuthToken();
    if (!token) {
      setScreenshotRecognitionNotice("请先登录云端账户以使用截图识别");
      return;
    }

    const form = new FormData();
    form.append("image", file);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    setScreenshotRecognitionBusy(true);
    setScreenshotRecognitionNotice("正在识别截图，请稍候…");
    try {
      const response = await fetch(`${getCloudApiUrl().replace(/\/$/, "")}/api/transactions/recognize-screenshot`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        type?: string | null;
        amount?: number | null;
        merchant?: string | null;
        date?: string | null;
        platform?: string | null;
        category?: string | null;
        description?: string | null;
        confidence?: string;
        warnings?: string[];
        transactions?: Array<{
          type?: string | null;
          amount?: number | null;
          merchant?: string | null;
          date?: string | null;
          platform?: string | null;
          category?: string | null;
          description?: string | null;
          confidence?: string;
          warnings?: string[];
        }>;
      };
      if (!response.ok) {
        const errorMessage = response.status === 401
          ? payload.error || "登录已失效，请重新登录"
          : response.status === 404
            ? "当前 API 尚不支持截图识别，请重启 API 后重试"
            : payload.error || `截图识别失败（${response.status}）`;
        throw new Error(errorMessage);
      }

      const items = Array.isArray(payload.transactions) && payload.transactions.length > 0
        ? payload.transactions
        : [payload];
      const drafts = items.slice(0, 20).map((item, index): JournalDraft => {
        const recognizedType = item.type === "INCOME" || item.type === "TRANSFER" || item.type === "EXPENSE"
          ? item.type
          : "EXPENSE";
        const categoryOptions = recognizedType === "INCOME"
          ? incomeCategories
          : recognizedType === "TRANSFER"
            ? transferCategories
            : expenseCategories;
        const hasCategory = typeof item.category === "string" && categoryOptions.includes(item.category);
        const amountValid = typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount > 0;
        const recognizedPlatform = identifiablePaymentPlatforms.includes(item.platform ?? "")
          ? item.platform as string
          : null;
        const dateValid = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(item.date);
        const warnings = Array.isArray(item.warnings)
          ? item.warnings.filter((warning) => typeof warning === "string" && warning.trim())
          : [];
        if (!amountValid) warnings.push(translateText("第 {number} 笔没有识别出金额，请手工填写。", locale).replace("{number}", String(index + 1)));
        if (!hasCategory) warnings.push(translateText("第 {number} 笔分类未确认，请核对。", locale).replace("{number}", String(index + 1)));
        if (!recognizedPlatform) {
          warnings.push(translateText("第 {number} 笔未识别支付账户，已保留当前选择：{platform}，请核对。", locale)
            .replace("{number}", String(index + 1))
            .replace("{platform}", translateText(platform, locale)));
        }
        if (!dateValid) warnings.push(translateText("第 {number} 笔未识别交易时间，已填当前时间。", locale).replace("{number}", String(index + 1)));
        return {
          id: createId("screenshot-transaction"),
          type: recognizedType,
          amount: amountValid ? String(item.amount) : "",
          category: hasCategory && item.confidence !== "low"
            ? item.category as string
            : recognizedType === "INCOME" ? "工资" : recognizedType === "TRANSFER" ? "转账" : "餐饮",
          platform: recognizedPlatform ?? platform,
          merchant: typeof item.merchant === "string" ? item.merchant.trim() : "",
          description: typeof item.description === "string" ? item.description.trim() : "",
          date: dateValid ? item.date!.slice(0, 16) : nowText().slice(0, 16),
          confidence: item.confidence,
          warnings,
        };
      });
      setRecognizedDrafts(drafts);
      setActiveRecognizedDraftIndex(0);
      if (drafts.length > 1) {
        setType(drafts[0].type);
        setCategory(drafts[0].category);
        setPlatform(drafts[0].platform);
        setDate(drafts[0].date);
        setAmount("");
        setMerchant("");
        setDescription("");
      } else {
        applyJournalDraft(drafts[0]);
      }
      const reviewMessage = drafts.length > 1
        ? translateText("识别到 {count} 笔订单，请逐笔核对后保存。", locale).replace("{count}", String(drafts.length))
        : drafts[0].confidence === "low"
          ? translateText("识别结果把握较低，请重点核对金额和分类", locale)
          : translateText("截图已识别，请核对后保存", locale);
      const warnings = drafts.flatMap((draft) => draft.warnings ?? []).filter((warning, index, all) => all.indexOf(warning) === index);
      setScreenshotRecognitionNotice(warnings.length ? `${reviewMessage} ${warnings.slice(0, 3).join("；")}` : reviewMessage);
    } catch (error) {
      setScreenshotRecognitionNotice(error instanceof Error && error.name === "AbortError"
        ? "截图识别超时，请稍后重试"
        : error instanceof Error ? error.message : "截图识别失败，请稍后重试");
    } finally {
      window.clearTimeout(timeout);
      setScreenshotRecognitionBusy(false);
      if (screenshotRecognitionInputRef.current) screenshotRecognitionInputRef.current.value = "";
    }
  }

  async function saveRepayment() {
    if (!loan) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || loan.remainingAmount <= 0) return;
    const now = nowText();
    const paidInstallment = loan.monthlyPayment > 0 && value >= loan.monthlyPayment;
    const remainingAmount = Math.max(0, loan.remainingAmount - value);
    await repo.saveTransaction({
      id: createId("repayment"),
      userId: loan.userId,
      accountId: loan.accountId,
      amount: Math.min(value, loan.remainingAmount),
      type: "REPAYMENT",
      category: "还款",
      platform: loan.platform,
      merchant: loan.platform,
      date: date.length === 16 ? `${date}:00` : date,
      description: description || null,
      orderId: null,
      paymentMethod: null,
      status: "COMPLETED",
      loanId: loan.id,
      remarkCategory: null,
      createdAt: now,
      updatedAt: now,
    });
    await repo.saveLoan({
      ...loan,
      remainingAmount,
      paidPeriods: Math.min(loan.periods, loan.paidPeriods + (paidInstallment ? 1 : 0)),
      status: remainingAmount <= 0 ? "PAID_OFF" : loan.status === "PAID_OFF" ? "ACTIVE" : loan.status,
      updatedAt: now,
    });
    window.dispatchEvent(new Event("stark:transaction-saved"));
    window.dispatchEvent(new Event("stark:loan-saved"));
    onSaved?.();
    handleClose();
  }

  function toggleBatchMonth(month: number) {
    setBatchMonths((current) => current.includes(month)
      ? current.filter((item) => item !== month)
      : [...current, month].sort((left, right) => left - right));
  }

  async function saveSalaryBatch() {
    if (batchSaving) return;
    const amountValue = Number(batchAmount);
    const monthKeys = salaryBatchMonthKeys(Number(batchYear), batchMonths);
    if (!monthKeys.length) {
      setBatchNotice("请至少选择一个补录月份");
      return;
    }
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setBatchNotice("请输入大于 0 的每月工资金额");
      return;
    }

    setBatchSaving(true);
    setBatchNotice("正在检查已导入的工资记录...");
    try {
      const monthTransactions = await repo.getTransactionsByMonths(getCurrentAccountId(), monthKeys);
      const { pendingMonthKeys, skippedMonthKeys } = selectSalaryBatchMonths(
        monthKeys,
        monthTransactions as Transaction[],
      );
      if (!pendingMonthKeys.length) {
        setBatchNotice(`所选 ${monthKeys.length} 个月都已有工资收入，未重复新增。`);
        return;
      }

      const now = nowText();
      const transactions = buildSalaryBatchTransactions({
        monthKeys: pendingMonthKeys,
        amount: amountValue,
        platform,
        payday: Number(batchPayday),
        merchant: batchMerchant,
        accountId: getCurrentAccountId(),
        now,
        createTransactionId: () => createId("salary-batch"),
      });
      setBatchNotice(`正在补录 ${transactions.length} 笔工资收入...`);
      const result = await repo.importTransactions(transactions);
      const skipped = skippedMonthKeys.length + result.skipped;
      setBatchNotice(`已补录 ${result.imported} 笔${skipped ? `，跳过 ${skipped} 个已有工资月份` : ""}${result.errors ? `，失败 ${result.errors} 笔` : ""}。`);
      if (result.imported) window.dispatchEvent(new Event("stark:transaction-saved"));
    } catch (error) {
      setBatchNotice(`批量补录失败${error instanceof Error && error.message ? `：${error.message}` : "，请稍后重试"}`);
    } finally {
      setBatchSaving(false);
    }
  }

  async function saveAsset() {
    const value = Number(assetBalance);
    if (!Number.isFinite(value) || value === 0) return;
    const now = nowText();
    await repo.saveAsset({
      id: asset?.id ?? createId("asset"),
      userId: asset?.userId ?? "local-user",
      accountId: asset?.accountId ?? getCurrentAccountId(),
      name: assetName.trim() || "新资产",
      type: assetType,
      balance: value,
      currency: "CNY",
      createdAt: asset?.createdAt ?? now,
      updatedAt: now,
    });
    draftSubmittedRef.current = true;
    clearNewEntryDraft(draftKind);
    window.dispatchEvent(new Event("stark:asset-saved"));
    setAssetName("");
    setAssetBalance("");
    setAssetType("ALIPAY");
    onSaved?.();
    handleClose();
  }

  async function saveLoan() {
    const now = nowText();
    const total = Number(loanTotalAmount) || 0;
    await repo.saveLoan({
      id: loan?.id ?? createId("loan"),
      userId: loan?.userId ?? "local-user",
      accountId: loan?.accountId ?? getCurrentAccountId(),
      platform: loanPlatform.trim() || "新贷款",
      totalAmount: total,
      remainingAmount: loanRemainingAmount === "" ? total : Number(loanRemainingAmount) || 0,
      periods: Math.max(1, Number(loanPeriods) || 12),
      paidPeriods: loan?.paidPeriods ?? 0,
      monthlyPayment: Number(loanMonthlyPayment) || 0,
      dueDate: Math.min(31, Math.max(1, Number(loanDueDay) || 20)),
      status: loan?.status ?? "ACTIVE",
      matchKeywords: loanMatchKeywords.trim() || null,
      createdAt: loan?.createdAt ?? now,
      updatedAt: now,
    });
    draftSubmittedRef.current = true;
    clearNewEntryDraft(draftKind);
    window.dispatchEvent(new Event("stark:loan-saved"));
    setLoanPlatform("");
    setLoanMatchKeywords("");
    setLoanTotalAmount("");
    setLoanRemainingAmount("");
    setLoanMonthlyPayment("");
    setLoanPeriods("12");
    setLoanDueDay("20");
    onSaved?.();
    handleClose();
  }

  async function compressProofImage(file: File) {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
    if (file.size > 12 * 1024 * 1024) throw new Error("图片不能超过 12MB");
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片读取失败"));
      element.src = source;
    });
    const maxWidth = 720;
    const scale = Math.min(1, maxWidth / image.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片处理失败");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.62);
  }

  async function saveSavingsRecord() {
    if (!savingsPlan || !savingsGoal || recordSaving) return;
    const value = Number(recordedAmount);
    if (!Number.isFinite(value) || value <= 0) {
      setRecordNotice("实际存入金额必须大于 0");
      return;
    }
    setRecordSaving(true);
    setRecordNotice("");
    try {
      const now = nowText();
      const result = recordSavingsPlanDeposit(savingsPlan, savingsGoal, value, proofImage, now, recordedDate.length === 16 ? `${recordedDate}:00` : recordedDate);
      await repo.saveSavingsGoal(result.goal);
      await repo.saveSavingsPlan(result.plan);
      window.dispatchEvent(new Event("stark:savings-saved"));
      onSaved?.();
      handleClose();
    } catch (error) {
      setRecordNotice(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setRecordSaving(false);
    }
  }

  return (
    <div
      className={`journal-overlay ${isPage ? "page" : ""} ${floatingOverlay ? "floating" : ""} ${keyboardViewport ? "keyboard-open" : ""} ${visible ? "visible" : ""}`}
      style={keyboardViewportStyle}
      onClick={handleClose}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        ref={panelRef}
        className={`journal-panel modern-journal-shell ${isPage ? "page" : ""} ${floatingOverlay ? "floating" : ""} ${isSavings ? "savings" : ""} ${isSavingsRecord ? "savings-record" : ""} ${isAsset ? "asset" : ""} ${isLoan ? "loan" : ""} ${sheetReady ? "ready" : ""} ${visible ? "visible" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="journal-sheet-handle" aria-hidden="true" />
        <div className="journal-header modern-journal-header">
          <button type="button" className="journal-back-btn" onClick={handleClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="journal-header-title">{isSavings ? isEditingSavings ? "编辑储蓄目标" : "添加储蓄" : isSavingsRecord ? "记录储蓄" : isAsset ? (isEditingAsset ? "编辑资产" : "新增资产") : isLoan ? (isEditingLoan ? "编辑贷款" : "新增贷款") : isRepayment ? "记录贷款还款" : (isEditingTransaction ? "编辑流水" : "记一笔")}</span>
          <button type="button" className="journal-close-btn" onClick={handleClose}>
            ×
          </button>
        </div>

        <JournalActionTargetContext.Provider value={actionTarget}>
          <div className="journal-panel-body">
            {isSavings ? (
              <SavingsPlanner
                key={savingsGoalId ?? "new-savings-goal"}
                embedded
                onSaved={() => {
                  onSaved?.();
                  handleClose();
                }}
                savingsGoalId={savingsGoalId}
              />
            ) : isSavingsRecord ? (
              <div className="savings-record-form">
                <div className="savings-record-context">
                  <span>{savingsGoal?.name || "储蓄目标"}</span>
                  <strong>{savingsPlan?.month || ""}</strong>
                  <small>计划存入 ¥ {savingsPlan?.amount ?? 0}</small>
                </div>
                <label className="modern-form-group">
                  <span>实际存入</span>
                  <div className="modern-amount-box">
                    <span className="cur-sym">¥</span>
                    <input
                      className="modern-amount-field"
                      inputMode="decimal"
                      value={recordedAmount}
                      onChange={(event) => setRecordedAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="0.00"
                    />
                  </div>
                </label>
                <label className="modern-form-group">
                  <span>实际存入日期</span>
                  <DateTimePicker mode="datetime" className="modern-form-input" ariaLabel="选择实际存入日期" value={recordedDate} onChange={setRecordedDate} />
                </label>
                <div className="modern-form-group">
                  <span>图片凭证</span>
                  <input
                    ref={proofImageInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void compressProofImage(file).then(setProofImage).catch((error: unknown) => setRecordNotice(error instanceof Error ? error.message : "图片处理失败"));
                      event.target.value = "";
                    }}
                  />
                  {proofImage ? (
                    <div className="savings-proof-preview">
                      <button type="button" className="savings-proof-open" onClick={() => setPreviewProofImage(proofImage)} aria-label="查看图片凭证大图">
                        <img src={proofImage} alt="图片凭证预览" />
                      </button>
                      <button type="button" onClick={() => setProofImage(null)}>清除图片</button>
                    </div>
                  ) : (
                    <button type="button" className="savings-proof-picker" onClick={() => proofImageInputRef.current?.click()}>
                      <span>＋</span>
                      添加图片
                    </button>
                  )}
                </div>
                {previewProofImage ? <ProofImageViewer src={previewProofImage} onClose={() => setPreviewProofImage(null)} /> : null}
                {recordNotice ? <p className="savings-record-notice">{recordNotice}</p> : null}
                <JournalActionDock>
                  <button type="button" className="modern-primary-submit" disabled={recordSaving} onClick={() => void saveSavingsRecord()}>
                    {recordSaving ? "保存中…" : "保存记录"}
                  </button>
                </JournalActionDock>
              </div>
            ) : isAsset ? (
              <div className="modern-form-wrapper">
                <div className="modern-form-card">
                  <div className="modern-form-group">
                    <label>资产名称</label>
                    <input
                      value={assetName}
                      onChange={(event) => setAssetName(event.target.value)}
                      placeholder="如：招行工资卡 / 微信零钱"
                      className="modern-form-input"
                    />
                  </div>

                  <div className="modern-form-group">
                    <label>资产类型</label>
                    <div className="modern-select-pill-grid">
                      {assetTypes.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={`select-pill ${assetType === item ? "active" : ""}`}
                          onClick={() => setAssetType(item)}
                        >
                          {assetTypeLabels[item]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="modern-form-group">
                    <label>当前余额 (元)</label>
                    <div className="modern-amount-box">
                      <span className="cur-sym">¥</span>
                      <input
                        inputMode="decimal"
                        value={assetBalance}
                        onChange={(event) => setAssetBalance(event.target.value.replace(/[^\d.-]/g, ""))}
                        placeholder="0.00"
                        className="modern-amount-field"
                      />
                    </div>
                  </div>
                </div>
                <JournalActionDock>
                  <button type="button" className="modern-primary-submit" onClick={() => void saveAsset()}>
                    保存资产
                  </button>
                </JournalActionDock>
              </div>
            ) : isLoan ? (
              <div className="modern-form-wrapper">
                <div className="modern-form-card">
                  <div className="modern-form-group">
                    <label>贷款名称</label>
                    <input
                      value={loanPlatform}
                      onChange={(event) => setLoanPlatform(event.target.value)}
                      placeholder="如：建设银行房贷 / 招行车贷"
                      className="modern-form-input"
                    />
                  </div>
                  <div className="modern-form-group">
                    <label>账单匹配关键词（选填）</label>
                    <input
                      value={loanMatchKeywords}
                      onChange={(event) => setLoanMatchKeywords(event.target.value)}
                      placeholder="如：招行信用卡 1234；多个关键词用逗号分隔"
                      className="modern-form-input"
                    />
                    <small className="modern-form-tip">导入账单时，需同时命中还款字样和贷款名称/关键词才会自动冲销。</small>
                  </div>

                  <div className="modern-form-grid-2">
                    <div className="modern-form-group">
                      <label>贷款总额 (元)</label>
                      <input
                        inputMode="decimal"
                        value={loanTotalAmount}
                        onChange={(event) => setLoanTotalAmount(event.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="0.00"
                        className="modern-form-input"
                      />
                    </div>
                    <div className="modern-form-group">
                      <label>剩余本金 (元)</label>
                      <input
                        inputMode="decimal"
                        value={loanRemainingAmount}
                        onChange={(event) => setLoanRemainingAmount(event.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="默认等于总额"
                        className="modern-form-input"
                      />
                    </div>
                  </div>

                  <div className="modern-form-grid-3">
                    <div className="modern-form-group">
                      <label>每月月供 (元)</label>
                      <input
                        inputMode="decimal"
                        value={loanMonthlyPayment}
                        onChange={(event) => setLoanMonthlyPayment(event.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="0.00"
                        className="modern-form-input"
                      />
                    </div>
                    <div className="modern-form-group">
                      <label>总期数</label>
                      <input
                        inputMode="numeric"
                        value={loanPeriods}
                        onChange={(event) => setLoanPeriods(event.target.value.replace(/\D/g, ""))}
                        className="modern-form-input"
                      />
                    </div>
                    <div className="modern-form-group">
                      <label>每月还款日</label>
                      <input
                        inputMode="numeric"
                        value={loanDueDay}
                        onChange={(event) => setLoanDueDay(event.target.value.replace(/\D/g, ""))}
                        className="modern-form-input"
                      />
                    </div>
                  </div>
                </div>
                <JournalActionDock>
                  <button type="button" className="modern-primary-submit" onClick={() => void saveLoan()}>
                    保存贷款
                  </button>
                </JournalActionDock>
              </div>
            ) : isRepayment ? (
              <div className="modern-form-wrapper">
                <div className="modern-form-card">
                  <div className="modern-form-group"><label>还款金额 (元)</label><div className="modern-amount-box"><span className="cur-sym">¥</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" className="modern-amount-field" /></div></div>
                  <div className="modern-form-group"><label>实际还款日期</label><DateTimePicker mode="datetime" className="modern-form-input" ariaLabel="选择实际还款日期" value={date} onChange={setDate} /></div>
                  <div className="modern-form-group"><label>备注</label><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选" className="modern-form-input" /></div>
                </div>
                <JournalActionDock>
                  <button type="button" className="modern-primary-submit" disabled={!amount || Number(amount) <= 0} onClick={() => void saveRepayment()}>保存还款</button>
                </JournalActionDock>
              </div>
            ) : (
              <div className="modern-journal-flow">
                {!isSalaryPreset || salaryEntryOpen ? (
                  <div className="journal-entry-kind-switch" aria-label="记账类型">
                    <button
                      type="button"
                      className={!salaryEntryOpen ? "active" : ""}
                      onClick={() => {
                        setSalaryEntryOpen(false);
                        setType("EXPENSE");
                        setCategory("餐饮");
                      }}
                    >
                      普通记账
                    </button>
                    <button
                      type="button"
                      className={salaryEntryOpen ? "active" : ""}
                      onClick={() => {
                        setSalaryEntryOpen(true);
                        setType("INCOME");
                        setCategory("工资");
                      }}
                    >
                      添加薪资收入
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="journal-salary-entry-trigger"
                    onClick={() => {
                      setSalaryEntryOpen(true);
                      setType("INCOME");
                      setCategory("工资");
                    }}
                  >
                    ＋ 添加薪资收入
                  </button>
                )}

                {salaryEntryOpen ? (
                  <div className="salary-entry-mode-switch" aria-label="薪资录入方式">
                    <button type="button" className={salaryEntryMode === "single" ? "active" : ""} onClick={() => setSalaryEntryMode("single")}>单月录入</button>
                    <button type="button" className={salaryEntryMode === "batch" ? "active" : ""} onClick={() => setSalaryEntryMode("batch")}>批量补录</button>
                  </div>
                ) : null}

                {!salaryEntryOpen || salaryEntryMode === "single" ? <>
                {/* 顶栏类型切换 */}
                <div className="modern-type-switch">
                  {[
                    ["EXPENSE", "支出"],
                    ["INCOME", "收入"],
                    ["TRANSFER", "转账"],
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setType(val as TransactionType)}
                      className={`type-tab ${type === val ? "active" : ""}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* 单笔使用大金额输入；多笔识别时每笔在下方分别填写金额。 */}
                {recognizedDrafts.length <= 1 ? (
                  <div className="modern-amount-hero">
                    <span className="currency-label">¥</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                      placeholder="0.00"
                      className="amount-huge-input"
                    />
                    {amount ? (
                      <button type="button" className="amount-clear-btn" onClick={() => setAmount("")}>
                        ×
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {!salaryEntryOpen ? <div className="journal-screenshot-recognition">
                  <input
                    ref={screenshotRecognitionInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="journal-screenshot-recognition-input"
                    onChange={(event) => void recognizeScreenshot(event.target.files?.[0])}
                  />
                  <div className="journal-screenshot-recognition-row">
                    <button
                      type="button"
                      className="journal-screenshot-recognition-button"
                      aria-label="上传截图并识别账单"
                      disabled={screenshotRecognitionBusy}
                      onClick={() => screenshotRecognitionInputRef.current?.click()}
                    >
                      <svg className="journal-screenshot-recognition-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                        <path d="M4.25 8.25h3.1l1.4-2h6.5l1.4 2h3.1a1.25 1.25 0 0 1 1.25 1.25v8.25A1.25 1.25 0 0 1 19.75 19h-15a1.25 1.25 0 0 1-1.25-1.25V9.5a1.25 1.25 0 0 1 1.25-1.25Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12.25" cy="13.25" r="3.1" stroke="currentColor" strokeWidth="1.8" />
                      </svg>
                      <span>{screenshotRecognitionBusy ? "正在识别…" : "上传截图识别"}</span>
                    </button>
                    <span>截图会发送到已配置的 AI 服务识别；不会保存原图或自动入账，请核对结果。</span>
                  </div>
                  {screenshotRecognitionNotice ? (
                    <p className={`journal-screenshot-recognition-notice ${screenshotRecognitionBusy ? "loading" : ""}`} role="status">
                      {screenshotRecognitionNotice}
                    </p>
                  ) : null}
                </div> : null}

                {/* 精致分类网格 */}
                <div className="modern-section-block">
                  <span className="section-mini-title">左右滑动选择消费类型</span>
                  <div className="modern-category-matrix" aria-label="消费类型">
                    {categories.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setCategory(item)}
                        className={`category-tile ${category === item ? "active" : ""}`}
                      >
                        <div className="tile-icon-box">
                          <img src={categoryIconSrcForCategory(item, type)} alt="" className="tile-icon" />
                        </div>
                        <span className="tile-label">{item}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 支付账户选择 */}
                <div className="modern-section-block">
                  <span className="section-mini-title">支付账户</span>
                  <div className="modern-pill-row">
                    {platforms.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPlatform(item)}
                        className={`account-pill ${platform === item ? "active" : ""}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                {type === "EXPENSE" ? (
                  <div className="modern-section-block">
                    <label className="section-mini-title" htmlFor="journal-shopping-platform">
                      {translateText("购物平台（选填）", locale)}
                    </label>
                    <input
                      id="journal-shopping-platform"
                      type="text"
                      className="meta-input"
                      value={shoppingPlatform}
                      onChange={(event) => setShoppingPlatform(event.target.value)}
                      placeholder={translateText("例如：淘宝、拼多多", locale)}
                      autoComplete="off"
                      maxLength={191}
                    />
                  </div>
                ) : null}

                {/* 补充信息：日期、商户、备注 */}
                <div className="modern-section-block">
                  <span className="section-mini-title">{isBatchRecognition ? translateText("记账时间", locale) : "明细备注"}</span>
                  <div className={`modern-meta-grid ${isBatchRecognition ? "journal-batch-shared-date" : ""}`}>
                    <DateTimePicker
                      mode="datetime"
                      className="meta-input"
                      value={date}
                      onChange={setDate}
                      ariaLabel="选择账单日期和时间"
                    />
                    {!isBatchRecognition ? <>
                      <input
                        type="text"
                        className="meta-input"
                        value={merchant}
                        onChange={(e) => setMerchant(e.target.value)}
                        placeholder="商户名称（选填）"
                      />
                      <input
                        type="text"
                        className="meta-input span-2"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="添加消费备注..."
                      />
                    </> : null}
                  </div>
                </div>

                {isBatchRecognition ? (
                  <div className="journal-screenshot-recognition-list">
                    <div className="journal-screenshot-recognition-list-head">
                      <strong>{translateText("批量录入 {count} 笔", locale).replace("{count}", String(recognizedDrafts.length))}</strong>
                      <span>{translateText("每笔填写金额、备注和详细明细；上方的记账类型、分类、支付账户、购物平台和时间将应用到全部订单。", locale)}</span>
                    </div>
                    <div className="journal-screenshot-recognition-items">
                      {recognizedDrafts.map((draft, index) => (
                        <div key={draft.id ?? index} className={`journal-screenshot-recognition-item ${index === activeRecognizedDraftIndex ? "active" : ""}`}>
                          <div className="journal-screenshot-recognition-item-header">
                            <button
                              type="button"
                              className="journal-screenshot-recognition-item-select"
                              onClick={() => selectRecognizedDraft(index)}
                              aria-pressed={index === activeRecognizedDraftIndex}
                            >
                              {translateText("第 {number} 笔", locale).replace("{number}", String(index + 1))}
                            </button>
                            <button
                              type="button"
                              className="journal-screenshot-recognition-item-remove"
                              aria-label={translateText("删除这笔订单", locale)}
                              onClick={() => removeRecognizedDraft(index)}
                            >
                              ×
                            </button>
                          </div>
                          <div className="journal-screenshot-recognition-fields">
                            <label className="journal-screenshot-recognition-field">
                              <span>{translateText("金额", locale)}</span>
                              <div className="journal-screenshot-recognition-amount-input">
                                <span>¥</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={draft.amount}
                                  onFocus={() => selectRecognizedDraft(index)}
                                  onChange={(event) => updateRecognizedDraft(index, { amount: event.target.value.replace(/[^\d.]/g, "") })}
                                  placeholder={translateText("实付金额", locale)}
                                  aria-label={`${translateText("第 {number} 笔", locale).replace("{number}", String(index + 1))} ${translateText("金额", locale)}`}
                                />
                              </div>
                            </label>
                            <label className="journal-screenshot-recognition-field">
                              <span>{translateText("备注", locale)}</span>
                              <input
                                type="text"
                                value={draft.merchant}
                                onFocus={() => selectRecognizedDraft(index)}
                                onChange={(event) => updateRecognizedDraft(index, { merchant: event.target.value })}
                                placeholder={translateText("商户或简短备注", locale)}
                              />
                            </label>
                            <label className="journal-screenshot-recognition-field journal-screenshot-recognition-field-full">
                              <span>{translateText("详细明细", locale)}</span>
                              <input
                                type="text"
                                value={draft.description}
                                onFocus={() => selectRecognizedDraft(index)}
                                onChange={(event) => updateRecognizedDraft(index, { description: event.target.value })}
                                placeholder={translateText("商品名称或消费内容", locale)}
                              />
                            </label>
                          </div>
                          {draft.warnings?.length ? (
                            <p className="journal-screenshot-recognition-list-warning">{draft.warnings.slice(0, 3).join("；")}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* 底部行动操作 */}
                <JournalActionDock className="modern-action-bar">
                  <button
                    type="button"
                    className="action-sub-btn"
                    onClick={() => {
                      setAmount("");
                      setShoppingPlatform("");
                      setMerchant("");
                      setDescription("");
                      setRecognizedDrafts([]);
                      setActiveRecognizedDraftIndex(0);
                      setScreenshotRecognitionNotice("");
                    }}
                  >
                    清空重填
                  </button>
                  <button
                    type="button"
                    className="action-main-btn"
                    onClick={() => void saveTransaction()}
                    disabled={transactionSaving || screenshotRecognitionBusy || (isBatchRecognition
                      ? recognizedDrafts.some((draft) => !draft.amount || Number(draft.amount) <= 0)
                      : !amount || Number(amount) <= 0)}
                  >
                    {transactionSaving
                      ? translateText("正在保存…", locale)
                      : recognizedDrafts.length > 1
                        ? translateText("保存 {count} 笔记账", locale).replace("{count}", String(recognizedDrafts.length))
                        : translateText("保存记账", locale)}
                  </button>
                </JournalActionDock>
                </> : (
                  <div className="salary-batch-workbench">
                    <div className="salary-batch-intro">
                      <span>历史工资补录</span>
                      <p>选择年份和月份后，将按同一金额生成工资收入；已存在工资的月份会自动跳过。</p>
                    </div>

                    <label className="salary-batch-year-field">
                      <span>补录年份</span>
                      <input type="number" min={2000} max={9999} inputMode="numeric" value={batchYear} onChange={(event) => setBatchYear(event.target.value.replace(/\D/g, "").slice(0, 4))} />
                    </label>

                    <div className="salary-batch-months-section">
                      <div className="salary-batch-section-head">
                        <span>选择月份</span>
                        <div>
                          <button type="button" onClick={() => setBatchMonths(SALARY_BATCH_MONTHS)}>全选</button>
                          <button type="button" onClick={() => setBatchMonths([])}>清空</button>
                        </div>
                      </div>
                      <div className="salary-batch-month-grid">
                        {SALARY_BATCH_MONTHS.map((month) => (
                          <button key={month} type="button" className={batchMonths.includes(month) ? "active" : ""} onClick={() => toggleBatchMonth(month)} aria-pressed={batchMonths.includes(month)}>
                            {month}月
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="salary-batch-fields">
                      <label>
                        <span>每月工资（元）</span>
                        <div className="modern-amount-box">
                          <span className="cur-sym">¥</span>
                          <input inputMode="decimal" value={batchAmount} onChange={(event) => setBatchAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" />
                        </div>
                      </label>
                      <label>
                        <span>发薪日</span>
                        <div className="salary-batch-payday">
                          <input type="number" min={1} max={28} inputMode="numeric" value={batchPayday} onChange={(event) => setBatchPayday(event.target.value.replace(/\D/g, "").slice(0, 2))} />
                          <em>日</em>
                        </div>
                      </label>
                    </div>

                    <div className="modern-section-block">
                      <span className="section-mini-title">入账账户</span>
                      <div className="modern-pill-row">
                        {platforms.map((item) => (
                          <button key={item} type="button" onClick={() => setPlatform(item)} className={`account-pill ${platform === item ? "active" : ""}`}>{item}</button>
                        ))}
                      </div>
                    </div>

                    <label className="salary-batch-merchant-field">
                      <span>发薪单位（选填）</span>
                      <input value={batchMerchant} onChange={(event) => setBatchMerchant(event.target.value)} placeholder="未填写则标记为工资补录" />
                    </label>

                    <p className={`salary-batch-notice ${batchNotice.startsWith("已补录") ? "success" : ""}`} role="status">
                      {batchNotice || (batchMonths.length ? `已选择 ${batchMonths.length} 个月，确认后将先检查是否已有工资记录。` : "请选择要补录的月份。")}
                    </p>
                    <JournalActionDock>
                      <button type="button" className="salary-batch-submit" disabled={batchSaving || !batchMonths.length || !batchAmount || Number(batchAmount) <= 0} onClick={() => void saveSalaryBatch()}>
                        {batchSaving ? "补录中..." : `确认补录 ${batchMonths.length} 个月工资`}
                      </button>
                    </JournalActionDock>
                  </div>
                )}
              </div>
            )}
          </div>
        </JournalActionTargetContext.Provider>
        <div className="journal-panel-footer" ref={setActionTarget} />
      </div>
    </div>
  );
}
