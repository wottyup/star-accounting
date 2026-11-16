import type { TransactionType } from "../models/types";

export type RecognitionOverrides = {
  platform?: string;
  date?: string;
  shoppingPlatform?: string;
};

export type JournalDraft = {
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
  recognitionOverrides?: RecognitionOverrides;
  screenshotSourceId?: string;
};

/** Use the visible form as the shared source for every retained batch item. */
export function prepareJournalDrafts(current: JournalDraft, recognized: JournalDraft[]): JournalDraft[] {
  if (recognized.length === 0) return [{ ...current }];
  if (recognized.length === 1) return [{ ...recognized[0], ...current }];

  const { type, category, platform, shoppingPlatform, date } = current;
  return recognized.map((draft) => ({ ...draft, type, category, platform, shoppingPlatform, date }));
}

/** Manual choices can change while the recognition request is still pending. */
export function applyScreenshotRecognition(
  recognized: JournalDraft[],
  current: JournalDraft,
  overrides: RecognitionOverrides,
): JournalDraft[] {
  if (recognized.length === 0) return [];
  const selected = { ...recognized[0], shoppingPlatform: current.shoppingPlatform, ...overrides };
  return prepareJournalDrafts(selected, recognized);
}
