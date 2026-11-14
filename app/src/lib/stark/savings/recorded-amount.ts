import type { SavingsPlan } from "../models/types";

export function savingsPlanRecordedAmount(plan: Pick<SavingsPlan, "amount" | "status" | "actualAmount">) {
  if (plan.status !== "COMPLETED") return 0;
  const actualAmount = Number(plan.actualAmount);
  return plan.actualAmount !== null && plan.actualAmount !== undefined && Number.isFinite(actualAmount) && actualAmount >= 0
    ? actualAmount : plan.amount;
}
