import type { BillImportRow, BillImportSource } from "@/lib/stark/import/bill-csv";

function hash32(value: string, seed: number, multiplier: number) {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), multiplier);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Stable within an account, including backup bills without an order number. */
export function importedTransactionId(accountId: string, fileName: string, source: BillImportSource, row: BillImportRow, index: number) {
  const sourceKey = row.sourceId
    ? `backup:${row.sourceId}`
    : row.orderId
      ? `${source}:order:${row.orderId}`
      : `${source}:row:${fileName}:${index}:${JSON.stringify(row)}`;
  const value = `${accountId}\u0000${sourceKey}`;
  return `import-${hash32(value, 0x811c9dc5, 0x01000193)}${hash32(value, 0x9e3779b1, 0x85ebca6b)}`;
}
