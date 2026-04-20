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

/**
 * アプリのモード
 * - single_subject: 従来モード（クラス名のみ表示、教科は任意）
 * - homeroom: 担任モード（担任クラス固定、コマには教科名のみ表示）
 * - multi_subject: 複数教科モード（クラス×教科の組み合わせ表示）
 */
export type TimetableMode = 'single_subject' | 'homeroom' | 'multi_subject';

/** 休校日・祝日エントリ */
export interface HolidayEntry {
  /** YYYY-MM-DD */
  date: string;
  /** 祝日名または休校日名（省略可） */
  name?: string;
}

/** 教科定義 */
export interface SubjectDef {
  /** 教科名（一意のキー） */
  name: string;
  /** 略称（省略可） */
  short?: string;
  /** 教科色（省略時はデフォルト色） */
  color?: string;
}

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
  /** 祝日・休校日リスト */
  holidays?: HolidayEntry[];
  /** 担任クラス（homeroomモード用） */
  homeroomClass?: string;
  /**
   * 教科基礎時間割（homeroomモード用）
   * 曜日 -> 時限 -> 教科名（null = 教科未設定）
   */
  subjectSchedule?: Record<string, Record<number, string | null>>;
  /**
   * 時程表（各コマの開始・終了時刻）
   * 一括設定: period -> { start: "HH:MM", end: "HH:MM" }
   * 曜日別設定: weekday -> period -> { start: "HH:MM", end: "HH:MM" }
   * 両方の場合は曜日別設定が優先（曜日別になければ一括設定をフォールバック）
   */
  periodTimes?: Record<number, { start: string; end: string }>;
  /**
   * 曜日別時程表（曜日ごとに時刻が異なる場合）
   * weekday -> period -> { start: "HH:MM", end: "HH:MM" }
   * weekdayは "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
   */
  periodTimesByDay?: Record<string, Record<number, { start: string; end: string }>>;

  // ─── 二重レイヤー管理（C案土台） ─────────────────────────────────────
  /**
   * 担任クラスの基本時間割（二重レイヤー管理 / C案用）
   * 自分が授業しない時間に、担任クラスが他の教員から受けている授業を記録する
   * 構造: 曜日 -> 時限 -> 教科名（null = 未設定）
   * 例: { "mon": { 1: "国語", 2: "算数" }, "tue": { 1: "体育" } }
   * 未記入の場合は既存の動作に影響しない
   */
  homeroomSubjectSchedule?: Record<string, Record<number, string | null>>;

  /**
   * 担任クラスの担当教員基本設定（二重レイヤー管理 / C案用）
   * 構造: 曜日 -> 時限 -> 教員名（null = 未設定）
   * 例: { "mon": { 1: "田中先生", 2: "山田先生" } }
   */
  homeroomTeacherSchedule?: Record<string, Record<number, string | null>>;
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
    /**
     * アプリモード（後方互換: 省略時は 'single_subject'）
     * - single_subject: 従来モード
     * - homeroom: 担任モード
     * - multi_subject: 複数教科モード
     */
    mode?: TimetableMode;
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
  /** 教科リスト（全モードで使用可能） */
  subjects?: SubjectDef[];
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
  year?: string,
  mode?: TimetableMode
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
      mode: mode ?? 'single_subject',
    },
    base: [],
    ops: [],
    subjects: [],
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
    /** 教科基礎時間割（homeroomモード用） */
    subjectSchedule?: Record<string, Record<number, string | null>>;
    /** 担任クラスの授業基本時間割（二重レイヤー管理 / C案用） */
    homeroomSubjectSchedule?: Record<string, Record<number, string | null>>;
    /** 担任クラスの担当教員基本設定（二重レイヤー管理 / C案用） */
    homeroomTeacherSchedule?: Record<string, Record<number, string | null>>;
  } = {}
): TimetableEntry[] {
  const { periodsPerDay = 6, hasSaturday = false, hasSunday = false, baseSchedule, subjectSchedule, homeroomSubjectSchedule, homeroomTeacherSchedule } = options;
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
    const daySubjectSchedule = subjectSchedule?.[weekday];
    const dayHomeroomSubjectSchedule = homeroomSubjectSchedule?.[weekday];
    const dayHomeroomTeacherSchedule = homeroomTeacherSchedule?.[weekday];
    entries.push({
      date: dateStr,
      weekday,
      weekday_jp,
      periods: Array.from({ length: periodsPerDay }, (_, i) => {
        const period = i + 1;
        const cls = daySchedule?.[period] ?? null;
        const subj = daySubjectSchedule?.[period] ?? null;
        const homeroomSubj = dayHomeroomSubjectSchedule?.[period] ?? null;
        const homeroomTeacher = dayHomeroomTeacherSchedule?.[period] ?? null;
        return {
          period,
          class: cls,
          ...(subj !== null ? { subject: subj } : {}),
          // 担任クラス授業情報（未設定の場合はフィールド自体を省略しファイルサイズを小さく保つ）
          ...(homeroomSubj !== null ? { homeroomSubject: homeroomSubj } : {}),
          ...(homeroomTeacher !== null ? { homeroomTeacher: homeroomTeacher } : {}),
        };
      }),
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

  // 後方互換: modeが未設定の場合は 'single_subject' にフォールバック
  if (!file.meta.mode) {
    file.meta.mode = 'single_subject';
  }

  // 後方互換: subjectsが未設定の場合は空配列
  if (!file.subjects) {
    file.subjects = [];
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
      mode: 'single_subject',
    },
    base,
    ops: overrideBundle?.ops ?? [],
    overrideMeta: overrideBundle
      ? { notes: overrideBundle.notes, baseRef: overrideBundle.base }
      : undefined,
    subjects: [],
  };

  return {
    file: timetableFile,
    effective: finalEffective,
    warnings,
    loadedFiles,
  };
}

// ─── Sample Date Shift ─────────────────────────────────────────

/**
 * サンプルデータの全日付を現在日付に合わせてシフトする。
 *
 * アルゴリズム:
 * 1. サンプルの startDate の月曜日を基準週とする
 * 2. 現在日付の月曜日を基準週とする
 * 3. 差分（週数）を計算して全 base エントリと ops の日付を移動する
 * 4. semester の startDate / endDate も同様にシフトする
 *
 * 月曜→月曜で対応させるため曜日のズレは生じない。
 */
export function shiftTimetableToCurrentDate(file: TimetableFile): TimetableFile {
  const sem = file.semester;
  if (!sem?.startDate) return file;

  // サンプルの startDate の月曜日を求める
  const sampleStart = new Date(sem.startDate + "T00:00:00");
  const sampleMonday = getMondayLocal(sampleStart);

  // 現在日付の月曜日を求める
  const today = new Date();
  const todayMonday = getMondayLocal(today);

  // 差分日数
  const diffMs = todayMonday.getTime() - sampleMonday.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return file; // シフト不要

  const shiftDate = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + diffDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  // base エントリの日付をシフト
  const newBase: TimetableEntry[] = file.base.map(entry => ({
    ...entry,
    date: shiftDate(entry.date),
  }));

  // ops の日付をシフト
  const newOps: import("./timetable").OverrideOp[] = (file.ops ?? []).map(op => ({
    ...op,
    date: shiftDate(op.date),
  }));

  // semester の startDate / endDate をシフト
  const newSemester: SemesterMeta = {
    ...sem,
    startDate: shiftDate(sem.startDate),
    endDate: shiftDate(sem.endDate),
  };

  return {
    ...file,
    semester: newSemester,
    base: newBase,
    ops: newOps,
  };
}

/** ローカルタイムゾーンで月曜日を返す（UTC変換なし） */
function getMondayLocal(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
