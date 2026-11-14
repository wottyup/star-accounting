"use client";

import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "./BottomSheet";
import { ChoicePicker } from "./ChoicePicker";
import { DateTimePicker } from "./DateTimePicker";
import { translateValue, useAppLocale } from "@/lib/stark/i18n";
import type { SavingsFundEntry, SavingsFundInput, SavingsGoal, SavingsPlan } from "@/lib/stark/models";
import type { DataRepository } from "@/lib/stark/repository/DataRepository";
import { moneyCents, outstandingAllocations, savingsFundEntries, savingsFundOutstanding } from "@/lib/stark/savings/funds";
import { summarizeSavingsGoalProgress } from "@/lib/stark/savings/progress";
import { formatMoney } from "@/lib/stark/utils/format";
import { getCurrentAccountId } from "@/lib/stark/storage/local-config";
import { createId } from "@/lib/stark/utils/id";
import styles from "./savings-funds.module.css";

type Draft = { id: string; goalId: string; amount: string; date: string; note: string };
function newDraft(goalId: string): Draft {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return { id: createId("fund"), goalId, amount: "", date, note: "" };
}
function remaining(entry: SavingsFundEntry, entries: SavingsFundEntry[]) {
  return outstandingAllocations(entry, entries).reduce((sum, part) => sum + part.cents, 0) / 100;
}

export function SavingsFundPanel({ goals, plans, repo, onSaved }: {
  goals: SavingsGoal[]; plans: SavingsPlan[]; repo: DataRepository; onSaved: (goal: SavingsGoal) => void;
}) {
  const locale = useAppLocale();
  const en = locale === "en-US";
  const [operation, setOperation] = useState<{ goalId: string; withdrawal?: SavingsFundEntry } | null>(null);
  const [message, setMessage] = useState<{ amount: number; replenishing: boolean } | null>(null);
  const records = goals.flatMap((goal) => {
    const entries = savingsFundEntries(goal);
    return entries.filter((entry) => entry.kind === "WITHDRAWAL").map((entry) => ({ goal, entry, entries, outstanding: remaining(entry, entries) }));
  }).sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.entry.createdAt.localeCompare(a.entry.createdAt));
  const outstanding = goals.reduce((sum, goal) => sum + savingsFundOutstanding(goal), 0);
  const hasAvailable = goals.some((goal) => summarizeSavingsGoalProgress(goal, plans).savedAmount > 0);
  return <div className={styles.panel}>
    <section className={`home-card ${styles.overview}`}>
      <div><span>{en ? "To replenish" : "待补齐金额"}</span><strong>¥ {formatMoney(outstanding)}</strong><small>{en ? "Replenish in full or in parts" : "支持分次补齐，补回原储蓄计划"}</small></div>
      <button type="button" className={`action-main-btn ${styles.primary}`} disabled={!hasAvailable} onClick={() => { setMessage(null); setOperation({ goalId: goals.find((goal) => summarizeSavingsGoalProgress(goal, plans).savedAmount > 0)?.id ?? "" }); }}>{en ? "Withdraw" : "取用储蓄"}</button>
    </section>
    <p className={styles.hint}>{en ? "Withdrawals move savings to your available balance. Record any spending separately." : "取用会减少储蓄余额，释放到可支配结余；实际消费请另行记账。"}</p>
    {message ? <p className={styles.success} role="status">{en ? message.replenishing ? "Replenished" : "Withdrawn" : message.replenishing ? "已补齐" : "已取用"} ¥ {formatMoney(message.amount)}</p> : null}
    <section className={`home-card ${styles.history}`}>
      <div className="section-head"><h2>{en ? "Withdrawal history" : "取用记录"}</h2><span>{en ? `${records.length} withdrawals` : `${records.length} 笔`}</span></div>
      {records.length ? records.map(({ goal, entry, entries, outstanding: amount }) => {
        const replenishments = entries.filter((item) => item.kind === "REPLENISHMENT" && item.withdrawalId === entry.id).sort((a, b) => a.date.localeCompare(b.date));
        return <article key={`${goal.id}:${entry.id}`} className={styles.record}>
          <div className={styles.recordHead}><strong>{goal.name}</strong><strong>−¥ {formatMoney(entry.amountCents / 100)}</strong></div>
          <time>{entry.date.replace("T", " ")}</time>
          {entry.note ? <p className={styles.note}>{entry.note}</p> : null}
          <div className={styles.status}><span>{amount > 0 ? `${en ? "To replenish" : "待补齐"} ¥ ${formatMoney(amount)}` : en ? "Fully replenished" : "已补齐"}</span>{amount > 0 ? <button type="button" className={`action-sub-btn ${styles.secondary}`} onClick={() => { setMessage(null); setOperation({ goalId: goal.id, withdrawal: entry }); }}>{en ? "Replenish" : "补齐"}</button> : null}</div>
          {replenishments.length ? <details className={styles.details}><summary>{en ? `Replenished ¥${formatMoney(entry.amountCents / 100 - amount)} · ${replenishments.length} records` : `已补回 ¥ ${formatMoney(entry.amountCents / 100 - amount)} · ${replenishments.length} 笔记录`}</summary>{replenishments.map((item) => <div key={item.id} className={styles.replenishment}><div><time>{item.date.replace("T", " ")}</time>{item.note ? <p className={styles.note}>{item.note}</p> : null}</div><span>+¥ {formatMoney(item.amountCents / 100)}</span></div>)}</details> : null}
        </article>;
      }) : <div className="loan-empty">{en ? "No withdrawals yet. Saved money can be withdrawn here when needed." : "还没有取用记录，需要时可在这里取用已存入的资金。"}</div>}
    </section>
    {operation ? <FundForm key={`${operation.goalId}:${operation.withdrawal?.id ?? "new"}`} {...operation} goals={goals} plans={plans} repo={repo} onClose={() => setOperation(null)} onSaved={(goal, amount, replenishing) => { onSaved(goal); setMessage({ amount, replenishing }); }} /> : null}
  </div>;
}

function FundForm({ goals, plans, goalId, withdrawal, repo, onClose, onSaved }: {
  goals: SavingsGoal[]; plans: SavingsPlan[]; goalId: string; withdrawal?: SavingsFundEntry; repo: DataRepository;
  onClose: () => void; onSaved: (goal: SavingsGoal, amount: number, replenishing: boolean) => void;
}) {
  const locale = useAppLocale();
  const en = locale === "en-US";
  const replenishing = Boolean(withdrawal);
  const draftKey = `stark:savings-fund-draft:${getCurrentAccountId()}:${withdrawal?.id ?? "withdrawal"}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as Draft | null;
      if (saved && typeof saved.id === "string" && typeof saved.goalId === "string" && typeof saved.amount === "string" && typeof saved.date === "string" && typeof saved.note === "string") return saved;
    } catch { /* Storage is optional. */ }
    return newDraft(goalId);
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [closeRequest, setCloseRequest] = useState(0);
  const goal = goals.find((item) => item.id === (withdrawal ? goalId : draft.goalId));
  const limit = goal ? withdrawal ? remaining(withdrawal, savingsFundEntries(goal)) : summarizeSavingsGoalProgress(goal, plans).savedAmount : 0;
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* Keep in-memory draft. */ } }, [draft, draftKey]);
  function update(values: Partial<Draft>) { setDraft((old) => ({ ...old, ...values })); setError(""); }
  async function save() {
    if (savingRef.current) return;
    const amount = Number(draft.amount);
    if (!goal || !/^\d+(\.\d{1,2})?$/.test(draft.amount) || !Number.isFinite(amount) || amount <= 0 || moneyCents(amount) > moneyCents(limit)) {
      setError("请输入限额内的有效金额，最多保留两位小数。"); return;
    }
    if (!draft.date) { setError("请选择日期和时间。"); return; }
    const input: SavingsFundInput = { id: draft.id, kind: replenishing ? "REPLENISHMENT" : "WITHDRAWAL", amountCents: moneyCents(amount), date: draft.date, note: draft.note.trim(), withdrawalId: withdrawal?.id ?? null };
    savingRef.current = true; setSaving(true); setError("");
    try {
      const next = await repo.recordSavingsFundMovement(goal.id, input);
      try { sessionStorage.removeItem(draftKey); } catch { /* Storage is optional. */ }
      onSaved(next, amount, replenishing);
      window.dispatchEvent(new Event("stark:savings-saved"));
      setCloseRequest((value) => value + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(!message || /Failed to fetch|NetworkError|Load failed/i.test(message) ? "保存失败，请检查连接后重试。" : message);
    } finally { savingRef.current = false; setSaving(false); }
  }
  const translatedError = translateValue(error, locale);
  const errorMessage = en && /[\u3400-\u9fff]/.test(translatedError) ? translateValue("保存失败，请检查连接后重试。", locale) : translatedError;
  const title = en ? replenishing ? "Replenish savings" : "Withdraw savings" : replenishing ? "补齐储蓄" : "取用储蓄";
  return <BottomSheet title={title} onClose={onClose} closeRequest={closeRequest} className={styles.sheet} bodyClassName={styles.sheetBody}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className={styles.fields}>
        {replenishing ? <div className={styles.origin}><strong>{goal?.name}</strong><p>{withdrawal?.date.replace("T", " ")} · {en ? "Original withdrawal" : "原取用"} ¥ {formatMoney((withdrawal?.amountCents ?? 0) / 100)}</p></div> : <div className="settings-url-field"><span>{en ? "Savings goal" : "取用目标"}</span><ChoicePicker value={draft.goalId} onChange={(value) => update({ goalId: value })} ariaLabel={en ? "Savings goal" : "取用目标"} title={en ? "Select savings goal" : "选择取用目标"} disabled={saving} options={goals.map((item) => ({ value: item.id, label: `${item.name} · ¥ ${formatMoney(summarizeSavingsGoalProgress(item, plans).savedAmount)}`, disabled: summarizeSavingsGoalProgress(item, plans).savedAmount <= 0 }))} /></div>}
        <label className="settings-url-field"><span>{en ? "Amount" : replenishing ? "本次补齐金额" : "取用金额"}</span><input autoFocus inputMode="decimal" value={draft.amount} disabled={saving} onChange={(event) => update({ amount: event.target.value })} placeholder="0.00" required /><small>{en ? replenishing ? "To replenish" : "Available" : replenishing ? "待补齐" : "可取用"} ¥ {formatMoney(limit)}{replenishing ? <button type="button" className={`action-sub-btn ${styles.fill}`} disabled={saving} onClick={() => update({ amount: limit.toFixed(2) })}>{en ? "Fill remaining" : "全部补齐"}</button> : null}</small></label>
        <div className="settings-url-field"><span>{en ? "Date and time" : "日期和时间"}</span><DateTimePicker value={draft.date} mode="datetime" ariaLabel={en ? "Date and time" : "日期和时间"} disabled={saving} onChange={(value) => update({ date: value })} /></div>
        <label className="settings-url-field"><span>{en ? "Note (optional)" : replenishing ? "补齐备注（可选）" : "取用用途（可选）"}</span><textarea rows={3} maxLength={500} value={draft.note} disabled={saving} onChange={(event) => update({ note: event.target.value })} placeholder={en ? "What is this for?" : "记一下这笔资金的用途"} /></label>
        <p className={styles.hint}>{en ? "Closing this form keeps your draft. Your balance changes only after saving." : "关闭页面会保留草稿，确认保存后才会变更余额。"}</p>
        {error ? <p className={styles.error} role="alert">{errorMessage}</p> : null}
      </div>
      <footer className={styles.footer}><button type="submit" className="action-main-btn" disabled={saving || limit <= 0}>{saving ? en ? "Saving…" : "保存中…" : en ? replenishing ? "Confirm replenishment" : "Confirm withdrawal" : replenishing ? "确认补齐" : "确认取用"}</button></footer>
    </form>
  </BottomSheet>;
}
