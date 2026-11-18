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

export function hasSharedRecognitionCategory(recognized: JournalDraft[]): boolean {
  return recognized.length > 0 && recognized.every((draft) => (
    draft.type === recognized[0].type && draft.category === recognized[0].category
  ));
}

/** Share account and time while keeping each item's classification. */
export function prepareJournalDrafts(current: JournalDraft, recognized: JournalDraft[]): JournalDraft[] {
  if (recognized.length === 0) return [{ ...current }];
  if (recognized.length === 1) return [{ ...recognized[0], ...current }];

  const { platform, shoppingPlatform, date } = current;
  return recognized.map((draft) => ({ ...draft, platform, shoppingPlatform, date }));
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
