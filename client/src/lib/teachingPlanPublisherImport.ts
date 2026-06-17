// 各教科書会社が配布する「年間指導計画」Excel の取り込み（P3）
// 設計: docs/teaching-plan-import-design.md
//
// v91 のアプリ専用Excel形式とは別物。各社のレイアウト差を吸収するため、
// 代表的な2形式を自動判別して取り込む。
//
//  形式A「単元ごとにシート（学習内容つき）」… 例: 啓林館 単元別
//      ヘッダ行に「小単元 / 時 / 学習内容 / 観点別評価規準」。1シート=1単元。
//      → 学習内容の各行をコマに展開（「時」が複数なら同内容を複数コマ）。
//
//  形式B「学年ごとにシート（配当表）」… 例: 啓林館 年間指導計画
//      ヘッダ行に「単元名 / 時数」。1行=1時。単元名欄の中単元ごとにまとめ、
//      時数行の数だけコマを作る（学習内容は無いので内容は空。先生が記入）。
//
// 取り出した { units: [{name, lessons[]}] } は applyTemplate() でそのまま適用できる。

import type { ApplyMode } from "./teachingPlanTemplates";

export interface ParsedPlan {
  gradeHint?: string;   // "5年" 等（判別できた場合）
  subjectHint: string;  // 既定 "理科"（UIで変更可）
  units: { name: string; lessons: string[] }[];
  periods: number;
}

export interface PublisherParseResult {
  kind: "perUnitSheets" | "perGradeAllocation" | "unknown";
  plans: ParsedPlan[];
  warnings: string[];
}

export type { ApplyMode };

// ─── セル値の文字列化（ExcelJSのrichText/formula対応）───────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellText(cell: any): string {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t: { text: string }) => t.text).join("");
    if ("result" in v) return String(v.result ?? "");
    if ("text" in v) return String(v.text ?? "");
    if (v instanceof Date) return "";
    return "";
  }
  return String(v);
}

function clean(s: string): string {
  return s.replace(/^[○●◯◎]\s*/, "").replace(/\r?\n/g, "").trim();
}

function countPeriods(jiText: string): number {
  if (!jiText) return 1;
  const nums = jiText.split(/[\s\n,、・]+/).filter((x) => /^[0-9０-９]+$/.test(x.trim()));
  return Math.max(1, nums.length);
}

function gradeFromName(name: string): string | undefined {
  const m = name.match(/([3-6３-６])\s*(?:年|th|st|nd|rd)/i);
  if (m) {
    const z = "３４５６", n = "3456";
    const d = z.includes(m[1]) ? n[z.indexOf(m[1])] : m[1];
    return `${d}年`;
  }
  return undefined;
}

// ─── 形式判定用ヘッダ探索 ────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findHeaderA(ws: any): { row: number; unit?: number; ji?: number; content?: number } | null {
  const maxR = Math.min(ws.rowCount || 25, 25);
  const maxC = Math.min(ws.columnCount || 12, 14);
  for (let r = 1; r <= maxR; r++) {
    let joined = "";
    const cols: { row: number; unit?: number; ji?: number; content?: number } = { row: r };
    for (let c = 1; c <= maxC; c++) {
      const v = cellText(ws.getCell(r, c));
      joined += v;
      if (v.includes("小単元")) cols.unit = c;
      else if (v.trim() === "時") cols.ji = c;
      else if (v.includes("学習内容") || v.includes("学習活動")) cols.content = c;
    }
    if ((joined.includes("学習内容") || joined.includes("学習活動")) && joined.includes("時") && cols.content) {
      return cols;
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findHeaderB(ws: any): { row: number; unit?: number; ji?: number } | null {
  const maxR = Math.min(ws.rowCount || 10, 10);
  const maxC = Math.min(ws.columnCount || 12, 14);
  for (let r = 1; r <= maxR; r++) {
    let joined = "";
    const cols: { row: number; unit?: number; ji?: number } = { row: r };
    for (let c = 1; c <= maxC; c++) {
      const v = cellText(ws.getCell(r, c)).trim();
      joined += v;
      if (v === "単元名") cols.unit = c;
      else if (v === "時数") cols.ji = c;
    }
    if (joined.includes("単元名") && joined.includes("時数") && cols.unit) return cols;
  }
  return null;
}

// ─── 形式A: 単元別シート（学習内容つき）─────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseUnitSheet(ws: any, hdr: { row: number; unit?: number; ji?: number; content?: number }): string[] {
  const lessons: string[] = [];
  const contentCol = hdr.content!;
  const jiCol = hdr.ji ?? 2;
  const last = ws.rowCount || hdr.row + 40;
  for (let r = hdr.row + 1; r <= last; r++) {
    const cell = ws.getCell(r, contentCol);
    // ExcelJSは結合セルの値を全セルに複製する。結合の先頭(master)以外はスキップして
    // 二重カウントを防ぐ（openpyxlは先頭のみ値を持つ挙動に合わせる）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const master = (cell as any).master;
    if (master && master.address && master.address !== cell.address) continue;
    const content = cellText(cell);
    if (content && content.trim()) {
      const n = countPeriods(cellText(ws.getCell(r, jiCol)));
      const c = clean(content).slice(0, 60);
      for (let i = 0; i < n; i++) lessons.push(c);
    }
  }
  return lessons;
}

function unitNameFromSheet(sheetName: string, titleCell: string): string {
  const t = clean(titleCell || "");
  // タイトルセルが単元名らしければ採用、そうでなければシート名
  const cand = t && t.length < 40 && !t.includes("着目") && !t.includes("ようにする") ? t : sheetName;
  return cand.replace(/^[\s\d０-９①-⑩１-９]+/, "").split(/[（(]/)[0].trim() || sheetName;
}

// ─── 形式B: 学年別配当表 ────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAllocationSheet(ws: any, hdr: { row: number; unit?: number; ji?: number }): { name: string; lessons: string[] }[] {
  const ucol = hdr.unit!;
  const jcol = hdr.ji ?? 5;
  const last = ws.rowCount || hdr.row + 200;
  const units: { name: string; lessons: string[] }[] = [];
  let cur: { name: string; lessons: string[] } | null = null;
  const isChapter = (s: string) => /^[\s]*[0-9０-９]+\s*[．.]/.test(s) || /^[●○◯]\s/.test(s);
  for (let r = hdr.row + 1; r <= last; r++) {
    const f = cellText(ws.getCell(r, ucol)).trim();
    const j = cellText(ws.getCell(r, jcol)).trim();
    if (f && (isChapter(f) || f.startsWith("●") || f.startsWith("○"))) {
      const name = f.replace(/^[●○◯]\s*/, "");
      cur = { name, lessons: [] };
      units.push(cur);
    }
    // 時数欄に値（数字 or 予 等）があれば1コマ
    if (j && cur) cur.lessons.push(""); // 配当表は内容なし → 空（先生が記入）
  }
  return units.filter((u) => u.lessons.length > 0);
}

// ─── エントリポイント ────────────────────────────────────────
export async function parsePublisherFile(file: File): Promise<PublisherParseResult> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const warnings: string[] = [];
  const sheets: { ws: import("exceljs").Worksheet; name: string }[] = [];
  wb.eachSheet((ws) => sheets.push({ ws, name: ws.name }));

  // 形式B（学年別配当表）優先判定: 単元名+時数ヘッダを持つ学年シートがあるか
  const bSheets = sheets
    .map((s) => ({ ...s, hdr: findHeaderB(s.ws), grade: gradeFromName(s.name) }))
    .filter((s) => s.hdr && s.grade);
  if (bSheets.length > 0) {
    const plans: ParsedPlan[] = [];
    for (const s of bSheets) {
      const units = parseAllocationSheet(s.ws, s.hdr!);
      if (units.length === 0) continue;
      plans.push({
        gradeHint: s.grade, subjectHint: "理科",
        units, periods: units.reduce((a, u) => a + u.lessons.length, 0),
      });
    }
    if (plans.length > 0) {
      warnings.push("配当表形式のため、各コマの内容は空で取り込みます（単元と時数は反映）。内容は編集してください。");
      return { kind: "perGradeAllocation", plans, warnings };
    }
  }

  // 形式A（単元別シート・学習内容つき）
  const fileGrade = gradeFromName(file.name);
  const units: { name: string; lessons: string[] }[] = [];
  for (const s of sheets) {
    const hdr = findHeaderA(s.ws);
    if (!hdr || !hdr.content) continue;
    const lessons = parseUnitSheet(s.ws, hdr);
    if (lessons.length === 0) continue;
    const title = cellText(s.ws.getCell(4, 1)) || cellText(s.ws.getCell(3, 1));
    units.push({ name: unitNameFromSheet(s.name, title), lessons });
  }
  if (units.length > 0) {
    return {
      kind: "perUnitSheets",
      plans: [{
        gradeHint: fileGrade, subjectHint: "理科",
        units, periods: units.reduce((a, u) => a + u.lessons.length, 0),
      }],
      warnings,
    };
  }

  return { kind: "unknown", plans: [], warnings: ["対応する表形式が見つかりませんでした。シート構成をご確認ください。"] };
}
