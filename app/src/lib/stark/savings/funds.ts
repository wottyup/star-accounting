import type { SavingsFundAllocation, SavingsFundEntry, SavingsFundInput, SavingsGoal, SavingsPlan } from "../models/types";
import { calculateCalendarPeriodCashflow, calculateSalaryCycleCashflow } from "../dashboard/salary-cycle.ts";
import { savingsPlanRecordedAmount } from "./recorded-amount.ts";

export function moneyCents(amount: number) {
  return Math.round(amount * 100);
}

export function savingsFundEntries(goal: Pick<SavingsGoal, "fundMovements">): SavingsFundEntry[] {
  if (!goal.fundMovements) return [];
  const entries = JSON.parse(goal.fundMovements) as SavingsFundEntry[];
  if (!Array.isArray(entries) || entries.some((entry) => !entry.id || !["WITHDRAWAL", "REPLENISHMENT"].includes(entry.kind)
    || !Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0 || !Array.isArray(entry.allocations)
    || entry.allocations.some((part) => !Number.isSafeInteger(part.cents) || part.cents <= 0)
    || entry.allocations.reduce((sum, part) => sum + part.cents, 0) !== entry.amountCents)) {
    throw new Error("储蓄资金记录无效，请刷新后重试。");
  }
  return entries;
}

export function outstandingAllocations(withdrawal: SavingsFundEntry, entries: readonly SavingsFundEntry[]) {
  const restored = new Map<string | null, number>();
  entries.filter((entry) => entry.kind === "REPLENISHMENT" && entry.withdrawalId === withdrawal.id)
    .flatMap((entry) => entry.allocations).forEach((part) => restored.set(part.planId, (restored.get(part.planId) ?? 0) + part.cents));
  return withdrawal.allocations.map((part) => ({ ...part, cents: part.cents - (restored.get(part.planId) ?? 0) })).filter((part) => part.cents > 0);
}

export function savingsFundOutstanding(goal: Pick<SavingsGoal, "fundMovements">) {
  const entries = savingsFundEntries(goal);
  return entries.reduce((sum, entry) => sum + (entry.kind === "WITHDRAWAL" ? entry.amountCents : -entry.amountCents), 0) / 100;
}

export function retainedSavingsPlanAmount(plan: SavingsPlan, goal?: SavingsGoal) {
  const entries = goal ? savingsFundEntries(goal) : [];
  const used = entries.reduce((sum, entry) => sum + (entry.kind === "WITHDRAWAL" ? 1 : -1)
    * entry.allocations.filter((part) => part.planId === plan.id).reduce((total, part) => total + part.cents, 0), 0);
  return Math.max(0, moneyCents(savingsPlanRecordedAmount(plan)) - used) / 100;
}

function validFundDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return false;
  const parsed = new Date(`${value}Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, value.length) === value;
}

function allocate(parts: SavingsFundAllocation[], amount: number) {
  let remaining = amount;
  const allocated: SavingsFundAllocation[] = [];
  for (const part of parts) {
    const cents = Math.min(remaining, part.cents);
    if (cents > 0) allocated.push({ ...part, cents });
    remaining -= cents;
  }
  if (remaining > 0) throw new Error("可用金额不足，请刷新后核对。");
  return allocated;
}

export function appendSavingsFundEntry(goal: SavingsGoal, plans: readonly SavingsPlan[], input: SavingsFundInput, now: string): SavingsGoal {
  if (!input.id || input.id.length > 191 || !["WITHDRAWAL", "REPLENISHMENT"].includes(input.kind)
    || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 1e12
    || !validFundDate(input.date)
    || typeof input.note !== "string" || input.note.length > 500) throw new Error("请核对金额、时间和备注。");
  const entries = savingsFundEntries(goal);
  const existing = entries.find((entry) => entry.id === input.id);
  if (existing) {
    if (existing.kind !== input.kind || existing.amountCents !== input.amountCents || existing.date !== input.date
      || existing.note !== input.note || (existing.withdrawalId ?? null) !== (input.withdrawalId ?? null)) throw new Error("这笔操作已保存，请刷新核对记录。");
    return goal;
  }
  let allocations: SavingsFundAllocation[];
  if (input.kind === "WITHDRAWAL") {
    if (input.withdrawalId) throw new Error("取用记录不能关联另一笔取用。");
    const goalPlans = plans.filter((plan) => plan.goalId === goal.id).sort((a, b) => a.month.localeCompare(b.month) || a.id.localeCompare(b.id));
    const recorded = goalPlans.reduce((sum, plan) => sum + moneyCents(savingsPlanRecordedAmount(plan)), 0);
    const legacyUsed = entries.reduce((sum, entry) => sum + (entry.kind === "WITHDRAWAL" ? 1 : -1)
      * entry.allocations.filter((part) => part.planId === null).reduce((total, part) => total + part.cents, 0), 0);
    const sources: SavingsFundAllocation[] = [
      { planId: null, month: null, cents: Math.max(0, moneyCents(goal.currentAmount) - recorded) - legacyUsed },
      ...goalPlans.map((plan) => ({ planId: plan.id, month: plan.month, cents: moneyCents(retainedSavingsPlanAmount(plan, goal)) })),
    ];
    if (input.amountCents > sources.reduce((sum, part) => sum + Math.max(0, part.cents), 0)) throw new Error("取用金额不能超过当前储蓄余额。");
    allocations = allocate(sources.filter((part) => part.cents > 0), input.amountCents);
  } else {
    const withdrawal = entries.find((entry) => entry.id === input.withdrawalId && entry.kind === "WITHDRAWAL");
    if (!withdrawal) throw new Error("找不到对应的取用记录，请刷新后重试。");
    const remaining = outstandingAllocations(withdrawal, entries);
    if (input.amountCents > remaining.reduce((sum, part) => sum + part.cents, 0)) throw new Error("补齐金额不能超过这笔取用的待补齐金额。");
    allocations = allocate(remaining, input.amountCents);
  }
  return { ...goal, fundMovements: JSON.stringify([...entries, { ...input, allocations, createdAt: now }]), updatedAt: now };
}

/** Cash released from or returned to savings, separate from spending/income. */
export function savingsFundCashflowPlans(goals: readonly SavingsGoal[]): SavingsPlan[] {
  return goals.flatMap((goal) => savingsFundEntries(goal).map((entry) => ({
    id: `fund:${entry.id}`, goalId: goal.id, amount: 0,
    actualAmount: (entry.kind === "WITHDRAWAL" ? -1 : 1) * entry.amountCents / 100,
    status: "COMPLETED" as const, month: entry.date.slice(0, 7), actualDate: entry.date,
    createdAt: entry.createdAt, updatedAt: entry.createdAt,
  })));
}

export function preserveSavingsFund(goal: SavingsGoal, existing: SavingsGoal | undefined, plans: readonly SavingsPlan[]) {
  const next = { ...goal, fundMovements: existing?.fundMovements ?? null };
  const recorded = plans.filter((plan) => plan.goalId === goal.id).reduce((sum, plan) => sum + savingsPlanRecordedAmount(plan), 0);
  if (moneyCents(Math.max(goal.currentAmount, recorded)) < moneyCents(savingsFundOutstanding(next))) {
    throw new Error("已存金额低于未补齐取用，请先补齐后再修改存款。");
  }
  const legacyUsed = savingsFundEntries(next).reduce((sum, entry) => sum + (entry.kind === "WITHDRAWAL" ? 1 : -1)
    * entry.allocations.filter((part) => part.planId === null).reduce((total, part) => total + part.cents, 0), 0);
  if (moneyCents(goal.currentAmount - recorded) < legacyUsed && legacyUsed > 0) throw new Error("期初储蓄还有未补齐取用，请先补齐后再减少存款。");
  if (existing && existing.accountId !== goal.accountId && savingsFundEntries(next).length) throw new Error("有资金流水的目标不能移动到账本。");
  return next;
}

export function assertSavingsPlanFundChange(goal: SavingsGoal | undefined, oldPlan: SavingsPlan | undefined, nextPlan?: SavingsPlan) {
  if (!goal || !oldPlan) return;
  const used = moneyCents(savingsPlanRecordedAmount(oldPlan) - retainedSavingsPlanAmount(oldPlan, goal));
  if (used > 0 && (!nextPlan || nextPlan.goalId !== oldPlan.goalId || nextPlan.month !== oldPlan.month || moneyCents(savingsPlanRecordedAmount(nextPlan)) < used)) {
    throw new Error("这项计划还有未补齐取用，请补齐后再删除或减少存款。");
  }
}

/** Gross transfers out of savings, independent of deposits and later repayments. */
export function savingsFundPeriodWithdrawals(goals: readonly SavingsGoal[], reportingPeriod: string, salaryDay: number, referenceDate: Date) {
  const withdrawals = savingsFundCashflowPlans(goals).filter((plan) => Number(plan.actualAmount) < 0);
  return {
    monthSavingsWithdrawal: -calculateCalendarPeriodCashflow([], withdrawals, reportingPeriod).savings || 0,
    cycleSavingsWithdrawal: -calculateSalaryCycleCashflow([], withdrawals, reportingPeriod, salaryDay, referenceDate).savings || 0,
  };
}
