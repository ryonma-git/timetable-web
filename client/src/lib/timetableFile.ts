// timetableFile.ts
// Design: Swiss Grid × Japanese Functional Design
// .timetable file format: proprietary JSON save format
// Also handles ZIP legacy import

import JSZip from "jszip";
import {
  TimetableEntry,
  OverrideOp,
  OverrideBundle,
  applyOverrides,
  WEEKDAY_JP,
  formatDate,
} from "./timetable";

// ─── .timetable File Format ────────────────────────────────────

export const TIMETABLE_FILE_VERSION = "1.0";
export const TIMETABLE_FILE_MIME = "application/json";
export const TIMETABLE_FILE_EXT = ".timetable";

export type SemesterSystem = "trimester" | "semester"; // 3学期制 / 2学期制

export type SchoolType = 'elementary' | 'junior' | 'high' | 'custom';

export interface SemesterMeta {
  /** 学期番号 (3学期制: 1,2,3 / 2学期制: 1,2) */
  semesterNumber: 1 | 2 | 3;
  /** 学期制 */
  semesterSystem?: SemesterSystem;
  /** 始業式 */
  startDate: string;  // YYYY-MM-DD
  /** 終業式 */
  endDate: string;    // YYYY-MM-DD
  /** 土曜授業 */
  hasSaturday: boolean;
  /** 日曜授業 */
  hasSunday: boolean;
  /** 基本時間割 (曜日 -> 時限 -> クラス) */
  baseSchedule?: Record<string, Record<number, string | null>>;
  /** カスタムクラスラベル（標準クラス以外に追加したもの） */
  customClasses?: string[];
  /** 学校種別 */
  schoolType?: SchoolType;
  /** 学年別クラス数 (index 0 = 1年生) */
  gradeClassCounts?: number[];
  /** 全クラスリスト（標準＋カスタム、ソート済み） */
  classList?: string[];
  /** 祝日・休校日リスト (YYYY-MM-DD) */
  holidays?: string[];
}

/** 複数学期の1学期分のデータ */
export interface SemesterData {
  /** 学期メタ情報 */
  semester: SemesterMeta;
  /** ベース時間割エントリ */
  base: TimetableEntry[];
  /** オーバーライド操作リスト */
  ops: OverrideOp[];
}

export interface TimetableFile {
  /** Format identifier */
  format: "timetable-app/v1";
  version: string;
  /** School/user metadata */
  meta: {
    title: string;
    school?: string;
    year?: string;
    createdAt: string;
    updatedAt: string;
  };
  /** Semester metadata (legacy single-semester support) */
  semester?: SemesterMeta;
  /** Base timetable entries (legacy single-semester support) */
  base: TimetableEntry[];
  /** All override operations (legacy single-semester support) */
  ops: OverrideOp[];
  /** Override bundle metadata */
  overrideMeta?: {
    notes?: string;
    baseRef?: string;
  };
  /** Multiple semesters (v2 format) */
  semesters?: SemesterData[];
  /** Currently active semester index (for multi-semester files) */
  activeSemesterIndex?: number;
}

export interface LoadResult {
  file: TimetableFile;
  effective: TimetableEntry[];
  warnings: string[];
}

// ─── Create new empty timetable ────────────────────────────────

export function createNewTimetableFile(
  title: string,
  school?: string,
  year?: string
): TimetableFile {
  const now = new Date().toISOString();
  return {
    format: "timetable-app/v1",
    version: TIMETABLE_FILE_VERSION,
    meta: {
      title,
      school,
      year,
      createdAt: now,
      updatedAt: now,
    },
    base: [],
    ops: [],
  };
}

// ─── Generate base entries for a date range ────────────────────

export function generateBaseEntries(
  startDate: string,
  endDate: string,
  options: {
    periodsPerDay?: number;
    hasSaturday?: boolean;
    hasSunday?: boolean;
    baseSchedule?: Record<string, Record<number, string | null>>;
  } = {}
): TimetableEntry[] {
  const { periodsPerDay = 6, hasSaturday = false, hasSunday = false, baseSchedule } = options;
  const entries: TimetableEntry[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    // Skip weekends unless enabled
    if (dayOfWeek === 6 && !hasSaturday) continue;
    if (dayOfWeek === 0 && !hasSunday) continue;

    const dateStr = formatDate(d);
    const weekday = weekdayNames[dayOfWeek];
    const weekday_jp = WEEKDAY_JP[weekday] ?? weekday;

    // Apply base schedule if provided
    const daySchedule = baseSchedule?.[weekday];

    entries.push({
      date: dateStr,
      weekday,
      weekday_jp,
      periods: Array.from({ length: periodsPerDay }, (_, i) => ({
        period: i + 1,
        class: daySchedule?.[i + 1] ?? null,
      })),
    });
  }

  return entries;
}

// ─── Serialize / Deserialize ────────────────────────────────────

export function serializeTimetableFile(file: TimetableFile): string {
  const updated: TimetableFile = {
    ...file,
    meta: { ...file.meta, updatedAt: new Date().toISOString() },
  };
  return JSON.stringify(updated, null, 2);
}

export function deserializeTimetableFile(json: string): LoadResult {
  const warnings: string[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("ファイルの解析に失敗しました。有効なJSONファイルか確認してください。");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.format !== "timetable-app/v1") {
    warnings.push(`不明なフォーマット: ${obj.format}。読み込みを試みます。`);
  }

  const file = obj as unknown as TimetableFile;

  if (!Array.isArray(file.base)) {
    throw new Error("baseデータが見つかりません。ファイルが破損している可能性があります。");
  }

  // Apply ops to get effective
  const { effective, audit } = applyOverrides(file.base, file.ops ?? []);

  // Collect audit warnings
  audit.filter(a => a.level === "warn").forEach(a => warnings.push(a.message));

  return { file, effective, warnings };
}

// ─── Download helper ───────────────────────────────────────────

export function downloadTimetableFile(file: TimetableFile, filename?: string) {
  const content = serializeTimetableFile(file);
  const blob = new Blob([content], { type: TIMETABLE_FILE_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `${file.meta.title || "timetable"}${TIMETABLE_FILE_EXT}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── ZIP Legacy Import ─────────────────────────────────────────

export interface ZipImportResult {
  file: TimetableFile;
  effective: TimetableEntry[];
  warnings: string[];
  loadedFiles: string[];
}

export async function importFromZip(zipFile: File): Promise<ZipImportResult> {
  const zip = await JSZip.loadAsync(zipFile);
  const warnings: string[] = [];
  const loadedFiles: string[] = [];

  let effectiveEntries: TimetableEntry[] = [];
  let baseEntries: TimetableEntry[] = [];
  let overrideBundle: OverrideBundle | null = null;

  // Helper to read JSON from zip
  const readJSON = async (filename: string): Promise<unknown | null> => {
    const file = zip.file(filename);
    if (!file) return null;
    try {
      const text = await file.async("text");
      return JSON.parse(text);
    } catch {
      warnings.push(`${filename} の解析に失敗しました`);
      return null;
    }
  };

  // Find files
  const allFiles = Object.keys(zip.files);
  loadedFiles.push(...allFiles.filter(f => !zip.files[f].dir));

  // Try to load effective JSON
  const effectiveFile = allFiles.find(f => f.includes("effective") && f.endsWith(".json"));
  if (effectiveFile) {
    const data = await readJSON(effectiveFile) as Record<string, unknown> | null;
    if (data?.by_date && Array.isArray(data.by_date)) {
      effectiveEntries = data.by_date as TimetableEntry[];
    }
  }

  // Try to load base JSON
  const baseFile = allFiles.find(f => (f.includes("base") || f.includes("_base")) && f.endsWith(".json"));
  if (baseFile) {
    const data = await readJSON(baseFile) as Record<string, unknown> | null;
    if (data?.by_date && Array.isArray(data.by_date)) {
      baseEntries = data.by_date as TimetableEntry[];
    }
  }

  // Try to load override JSON
  const overrideFile = allFiles.find(f => f.includes("override") && f.endsWith(".json"));
  if (overrideFile) {
    const data = await readJSON(overrideFile) as OverrideBundle | null;
    if (data?.ops) {
      overrideBundle = data;
    }
  }

  // Build effective from base + overrides
  const base = baseEntries.length > 0 ? baseEntries : effectiveEntries;
  let finalEffective = effectiveEntries;

  if (overrideBundle?.ops?.length && base.length > 0) {
    const { effective, audit } = applyOverrides(base, overrideBundle.ops);
    finalEffective = effective;
    audit.filter(a => a.level === "warn").forEach(a => warnings.push(a.message));
  }

  const now = new Date().toISOString();
  const timetableFile: TimetableFile = {
    format: "timetable-app/v1",
    version: TIMETABLE_FILE_VERSION,
    meta: {
      title: zipFile.name.replace(/\.zip$/i, ""),
      createdAt: now,
      updatedAt: now,
    },
    base,
    ops: overrideBundle?.ops ?? [],
    overrideMeta: overrideBundle
      ? { notes: overrideBundle.notes, baseRef: overrideBundle.base }
      : undefined,
  };

  return {
    file: timetableFile,
    effective: finalEffective,
    warnings,
    loadedFiles,
  };
}
