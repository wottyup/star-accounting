import * as XLSX from "xlsx";
import type { AccountArchiveData } from "./account-archive";
import type { Account } from "../models/types";

import { WORKBOOK_FORMAT, WORKBOOK_TABLES, type WorkbookTable, type WorkbookRow, type LedgerWorkbook } from "./ledger-workbook-format.ts";
export * from "./ledger-workbook-format.ts";
const CELL_LIMIT = 28_000;
const MAX_BYTES = 100 * 1024 * 1024;

export function createLedgerWorkbook(account: Account, data: AccountArchiveData) {
  const book = XLSX.utils.book_new();
  const rawSheets = { accounts: [account], transactions: data.transactions, assets: data.assets, budgets: data.budgets,
    loans: data.loans, savingsGoals: data.savingsGoals, savingsPlans: data.savingsPlans,
    subscriptions: data.subscriptions, categoryRules: data.categoryRules, importErrorLogs: data.importErrorLogs,
    exchangeRates: data.exchangeRates, themeConfigs: data.themeConfig ? [data.themeConfig] : [] };
  const sheets = Object.fromEntries(Object.entries(rawSheets).map(([key, rows]) => [key, rows.map((row) => ({ ...row }))])) as unknown as LedgerWorkbook["sheets"];
  const manifest = [["format", WORKBOOK_FORMAT], ["schemaVersion", 1], ["exportedAt", new Date().toISOString()],
    ["说明", "每个工作表保存一种业务数据；导入时创建账本副本。请保留表名与字段名。长文本表保存图片凭证等分段数据，请勿删除。"],
    ["类型", "工作表", "记录数"]];
  const longText: (string | number)[][] = [["table", "id", "field", "part", "value"]];
  let total = 0;
  for (const [key, name] of Object.entries(WORKBOOK_TABLES)) {
    const rows = sheets[key as WorkbookTable];
    total += rows.length;
    manifest.push([key, name, rows.length]);
    const fields = [...new Set(["id", ...rows.flatMap((row) => Object.keys(row))])];
    const cells = rows.map((row) => fields.map((field) => {
      const value = row[field];
      if (value === null || value === undefined) return null;
      const cell = typeof value === "object" ? JSON.stringify(value) : value;
      if (typeof cell === "string" && (cell.length > CELL_LIMIT || cell.startsWith("@star-long-text:"))) {
        let part = 0;
        for (let offset = 0; offset < cell.length; part += 1) {
          let end = Math.min(offset + CELL_LIMIT, cell.length);
          if (end < cell.length && /[\uD800-\uDBFF]/.test(cell[end - 1])) end -= 1;
          longText.push([key, String(row.id), field, part, cell.slice(offset, end)]);
          offset = end;
        }
        return `@star-long-text:${cell.length}:${part}`;
      }
      return cell;
    }));
    if (cells.length > 1_048_575) throw new Error(`${name}超过 Excel 单表行数上限，无法完整导出`);
    const sheet = XLSX.utils.aoa_to_sheet([fields, ...cells]);
    sheet["!cols"] = fields.map((field) => ({ wch: /description|remark|proof|Config|Movements/i.test(field) ? 36 : 22 }));
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(manifest), "格式说明");
  if (longText.length > 1_048_576) throw new Error("长文本超过 Excel 单表行数上限，无法完整导出");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(longText), "长文本");
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
  if (bytes.byteLength > MAX_BYTES) throw new Error("文件超过单次导出上限 100MB");
  return { bytes: new Uint8Array(bytes), totalRecordCount: total };
}

export async function readLedgerWorkbook(file: File): Promise<LedgerWorkbook> {
  if (!/\.xlsx$/i.test(file.name) || file.size > MAX_BYTES) throw new Error("请选择不超过 100MB 的本应用 Excel 工作簿");
  const bytes = await file.arrayBuffer();
  const book = XLSX.read(bytes, { type: "array", cellDates: false });
  const allowed = [...Object.values(WORKBOOK_TABLES), "格式说明", "长文本"];
  if (book.SheetNames.length !== allowed.length || book.SheetNames.some((name) => !allowed.includes(name))) {
    throw new Error("工作表缺失或包含未知工作表，请选择完整导出的账本工作簿");
  }
  const manifest = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets["格式说明"], { header: 1, raw: true });
  if (manifest[0]?.[1] !== WORKBOOK_FORMAT || manifest[1]?.[1] !== 1) throw new Error("账本工作簿格式或版本不受支持");
  const sheets = {} as LedgerWorkbook["sheets"];
  const recordIndex = new Map<string, WorkbookRow>();
  for (const [key, name] of Object.entries(WORKBOOK_TABLES)) {
    const rows = XLSX.utils.sheet_to_json<WorkbookRow>(book.Sheets[name], { raw: true, defval: null });
    const declared = manifest.find((row) => row[0] === key);
    if (!declared || declared[1] !== name || Number(declared[2]) !== rows.length) throw new Error(`${name}记录数量与导出说明不一致`);
    for (const row of rows) {
      if (typeof row.id !== "string" || !row.id || recordIndex.has(`${key}:${row.id}`)) throw new Error(`${name}中记录 ID 缺失或重复`);
      recordIndex.set(`${key}:${row.id}`, row);
    }
    sheets[key as WorkbookTable] = rows;
  }
  const chunks = XLSX.utils.sheet_to_json<{ table: string; id: string; field: string; part: number; value: string }>(book.Sheets["长文本"], { raw: true });
  const groups = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    const row = recordIndex.get(`${chunk.table}:${chunk.id}`);
    if (!row || !Object.hasOwn(row, chunk.field) || !Number.isSafeInteger(chunk.part) || chunk.part < 0 || typeof chunk.value !== "string") throw new Error("长文本工作表包含无效引用或分段");
    const key = JSON.stringify([chunk.table, chunk.id, chunk.field]);
    const group = groups.get(key) ?? [];
    group.push(chunk);
    groups.set(key, group);
  }
  for (const [table, rows] of Object.entries(sheets)) for (const row of rows) for (const [field, value] of Object.entries(row)) {
    if (typeof value === "string" && value.startsWith("@star-long-text:") && !groups.has(JSON.stringify([table, row.id, field]))) throw new Error("长文本分段缺失，无法完整导入");
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.part - b.part);
    if (group.some((part, index) => part.part !== index)) throw new Error("长文本分段缺失或重复，无法完整导入");
    const first = group[0];
    const row = recordIndex.get(`${first.table}:${first.id}`)!;
    const value = group.map((part) => part.value).join("");
    if (row[first.field] !== `@star-long-text:${value.length}:${group.length}`) throw new Error("长文本长度与记录不一致，无法完整导入");
    row[first.field] = value;
  }
  // Hash the file, so a retry restores the same copy and an edited file gets a new copy.
  const { sha256 } = await import("../utils/sha256.ts");
  const input: LedgerWorkbook = { format: WORKBOOK_FORMAT, schemaVersion: 1, importId: sha256(new Uint8Array(bytes)), sheets };
  if (new Blob([JSON.stringify(input)]).size > MAX_BYTES) throw new Error("工作簿展开后的数据超过 100MB 导入上限");
  return input;
}
