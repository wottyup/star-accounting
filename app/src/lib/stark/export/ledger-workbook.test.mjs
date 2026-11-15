import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import * as XLSX from "xlsx";
import { createLedgerWorkbook, readLedgerWorkbook, WORKBOOK_TABLES } from "./ledger-workbook.ts";
import { sha256 } from "../utils/sha256.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../../../testdata/ledger-workbook.json", import.meta.url), "utf8"));
function exported() {
  const sheets = structuredClone(fixture.sheets);
  const account = sheets.accounts[0];
  const data = { ...sheets, themeConfig: sheets.themeConfigs[0] };
  data.savingsPlans[0].proofImage = "data:image/png;base64," + "a".repeat(120000);
  data.savingsPlans[0].remark = "汉字😀".repeat(13000);
  return { account, data, result: createLedgerWorkbook(account, data) };
}
function file(bytes) { return new File([bytes], "ledger.xlsx"); }

test("multi-sheet workbook round trip retains every type, values, IDs, and long images", async () => {
  const { account, data, result } = exported();
  const restored = await readLedgerWorkbook(file(result.bytes));
  assert.equal(restored.sheets.accounts[0].openingBalance, account.openingBalance);
  for (const key of Object.keys(WORKBOOK_TABLES)) {
    const expected = key === "accounts" ? [account] : key === "themeConfigs" ? [data.themeConfig] : data[key];
    assert.deepEqual(JSON.parse(JSON.stringify(restored.sheets[key])), JSON.parse(JSON.stringify(expected)).map((row) => {
      // Exported columns represent missing optional cells as null.
      for (const other of expected) for (const field of Object.keys(other)) if (!(field in row)) row[field] = null;
      return row;
    }));
  }
  assert.equal(restored.importId, createHash("sha256").update(result.bytes).digest("hex"));
  assert.equal(result.totalRecordCount, Object.values(fixture.sheets).reduce((n, rows) => n + rows.length, 0));
});

test("rejects deleted long-text chunks rather than losing a proof image", async () => {
  const { result } = exported();
  const book = XLSX.read(result.bytes, { type: "array" });
  book.Sheets["长文本"] = XLSX.utils.aoa_to_sheet([["table", "id", "field", "part", "value"]]);
  await assert.rejects(readLedgerWorkbook(file(XLSX.write(book, { type: "array", bookType: "xlsx" }))), /长文本分段缺失/);
});

test("rejects missing business sheets", async () => {
  const { result } = exported();
  const book = XLSX.read(result.bytes, { type: "array" });
  book.SheetNames = book.SheetNames.filter((name) => name !== "预算");
  await assert.rejects(readLedgerWorkbook(file(XLSX.write(book, { type: "array", bookType: "xlsx" }))), /工作表缺失/);
});

test("rejects changed row counts instead of silently importing incomplete data", async () => {
  const { result } = exported();
  const book = XLSX.read(result.bytes, { type: "array" });
  book.Sheets["账单"] = XLSX.utils.aoa_to_sheet([["id"]]);
  await assert.rejects(readLedgerWorkbook(file(XLSX.write(book, { type: "array", bookType: "xlsx" }))), /记录数量/);
});

test("empty business sheets still round trip as part of a full workbook", async () => {
  const input = structuredClone(fixture.sheets);
  for (const key of Object.keys(input)) if (key !== "accounts") input[key] = [];
  const result = createLedgerWorkbook(input.accounts[0], { ...input, themeConfig: null });
  const restored = await readLedgerWorkbook(file(result.bytes));
  assert.equal(result.totalRecordCount, 1);
  assert.deepEqual(restored.sheets, input);
});

test("LAN hash matches SHA-256 including multi-block content", () => {
  for (const value of ["", "abc", "😀汉字".repeat(1000)]) {
    const bytes = new TextEncoder().encode(value);
    assert.equal(sha256(bytes), createHash("sha256").update(bytes).digest("hex"));
  }
});
