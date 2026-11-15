import type { ImportResult, Transaction } from "../models/types";

const MAX_ROWS = 1000;
const MAX_BYTES = 768 * 1024; // Stay below the Go API's 1 MiB request limit.

function* batches(transactions: Transaction[]) {
  const encoder = new TextEncoder();
  let offset = 0;
  let rows: string[] = [];
  let bytes = 2; // JSON array brackets.
  for (let index = 0; index < transactions.length; index++) {
    const row = JSON.stringify(transactions[index]);
    const size = encoder.encode(row).length;
    if (size + 2 > MAX_BYTES) throw new Error(`第 ${index + 1} 笔账单内容过大，请缩短备注或明细后重试`);
    if (rows.length && (rows.length === MAX_ROWS || bytes + 1 + size > MAX_BYTES)) {
      yield { offset, count: rows.length, body: `[${rows.join(",")}]` };
      offset += rows.length;
      rows = [];
      bytes = 2;
    }
    bytes += size + (rows.length ? 1 : 0);
    rows.push(row);
  }
  if (rows.length) yield { offset, count: rows.length, body: `[${rows.join(",")}]` };
}

export async function importTransactionBatches(
  transactions: Transaction[],
  submit: (body: string) => Promise<ImportResult>,
  onProgress?: (completed: number, total: number) => void,
): Promise<ImportResult> {
  const summary: ImportResult = { imported: 0, skipped: 0, errors: 0, failedRows: [], loanRepayments: 0, loanRepaymentAmount: 0 };
  for (const batch of batches(transactions)) {
    const result = await submit(batch.body);
    summary.imported += result.imported;
    summary.skipped += result.skipped;
    summary.errors += result.errors;
    summary.loanRepayments! += result.loanRepayments ?? 0;
    summary.loanRepaymentAmount! += result.loanRepaymentAmount ?? 0;
    summary.failedRows!.push(...(result.failedRows ?? []).map(row => ({ ...row, lineNumber: row.lineNumber + batch.offset })));
    onProgress?.(batch.offset + batch.count, transactions.length);
  }
  return summary;
}
