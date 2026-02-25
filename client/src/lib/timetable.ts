// timetable.ts
// Design: Swiss Grid × Japanese Functional Design
// Core data models, override engine, stats calculation

// ─── Data Models ───────────────────────────────────────────────

export interface PeriodSlot {
  period: number;       // 1-6
  class: string | null; // null = no class
  reason?: string;
}

export interface TimetableEntry {
  date: string;         // "YYYY-MM-DD"
  weekday: string;      // "Mon", "Tue", ...
  weekday_jp: string;   // "月", "火", ...
  periods: PeriodSlot[];
}

export interface EffectiveBundle {
  by_date: TimetableEntry[];
  meta?: Record<string, string>;
}

export type OverrideOpType =
  | "clear_period_class"
  | "set_period_class"
  | "set_period_reason"
  | "set_day_reason";

export interface OverrideOp {
  id?: string;
  op: OverrideOpType;
  date: string;
  period?: number;
  class?: string | null;
  target_class?: string | null;
  reason?: string;
  replace?: boolean;
  clear_all_classes?: boolean;
  applied_at?: string;
}

export interface OverrideBundle {
  schema?: string;
  generated_at?: string;
  base?: string;
  notes?: string;
  ops: OverrideOp[];
}

export interface ClassStats {
  class: string;
  grade: string;
  totalPeriods: number;
  completedPeriods: number;
  remainingPeriods: number;
  completionRate: number;
  asOfDate: string;
}

export interface AuditEntry {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  date?: string;
  period?: number;
  opType?: string;
  before?: string | null;
  after?: string | null;
  targetClass?: string | null;
}

export interface CellID {
  date: string;
  period: number;
}

// ─── Constants ─────────────────────────────────────────────────

export const VALID_PERIODS = [1, 2, 3, 4, 5, 6] as const;

export const WEEKDAY_JP: Record<string, string> = {
  Mon: "月", Tue: "火", Wed: "水", Thu: "木", Fri: "金", Sat: "土", Sun: "日",
};

// Default class list (6 grades × 3 classes = 18 classes)
export const VALID_CLASSES: string[] = (() => {
  const classes: string[] = [];
  for (let grade = 1; grade <= 6; grade++) {
    for (let group = 1; group <= 3; group++) {
      classes.push(`${grade}年${group}組`);
    }
  }
  return classes;
})();

// ─── Class Utilities ────────────────────────────────────────────

/** 全角数字・全角スペースを半角に正規化する */
export function normalizeClassName(name: string): string {
  return name
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    .trim();
}

/** 「n年m組」形式かどうかを判定する */
export function isStandardClass(name: string): boolean {
  return /^\d+年\d+組$/.test(name);
}

/** クラス名からソートキーを生成する（学年→組の順） */
export function classSort(a: string, b: string): number {
  const parseClass = (s: string): [number, number] | null => {
    const m = s.match(/^(\d+)年(\d+)組$/);
    if (!m) return null;
    return [parseInt(m[1]), parseInt(m[2])];
  };
  const pa = parseClass(a);
  const pb = parseClass(b);
  if (pa && pb) {
    if (pa[0] !== pb[0]) return pa[0] - pb[0];
    return pa[1] - pb[1];
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b, 'ja');
}

/** 学校種別に応じたデフォルトクラスリストを生成する */
export type SchoolType = 'elementary' | 'junior' | 'high' | 'custom';

export function generateDefaultClasses(
  schoolType: SchoolType,
  gradeClassCounts?: number[] // index 0 = grade 1, etc.
): string[] {
  const grades = schoolType === 'elementary' ? 6
    : schoolType === 'junior' ? 3
    : schoolType === 'high' ? 3
    : (gradeClassCounts?.length ?? 6);
  const classes: string[] = [];
  for (let g = 1; g <= grades; g++) {
    const count = gradeClassCounts?.[g - 1] ?? 3;
    for (let c = 1; c <= count; c++) {
      classes.push(`${g}年${c}組`);
    }
  }
  return classes;
}

export const REASON_PRESETS = [
  "手動調整", "行事", "祝日", "欠勤", "補填", "特別授業", "振替", "研修",
];

// ─── Override Engine ────────────────────────────────────────────

function deepCopyEntries(entries: TimetableEntry[]): TimetableEntry[] {
  return entries.map(e => ({
    ...e,
    periods: e.periods.map(p => ({ ...p })),
  }));
}

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function applyOverrides(
  base: TimetableEntry[],
  ops: OverrideOp[]
): { effective: TimetableEntry[]; audit: AuditEntry[] } {
  const entries = deepCopyEntries(base);
  const dateIndex = new Map<string, number>();
  entries.forEach((e, i) => dateIndex.set(e.date, i));
  const audit: AuditEntry[] = [];

  for (const op of ops) {
    const idx = dateIndex.get(op.date);
    if (idx === undefined) {
      audit.push({
        id: nanoid(), level: "warn",
        message: `date not found: ${op.date}`,
        date: op.date, opType: op.op,
      });
      continue;
    }

    switch (op.op) {
      case "clear_period_class": {
        if (op.period === undefined) break;
        const slotIdx = entries[idx].periods.findIndex(p => p.period === op.period);
        if (slotIdx === -1) break;
        const before = entries[idx].periods[slotIdx].class;
        if (op.target_class && before !== op.target_class) {
          audit.push({
            id: nanoid(), level: "warn",
            message: `target_class mismatch: 期待「${op.target_class}」実際「${before ?? "null"}」`,
            date: op.date, period: op.period, opType: op.op,
            before, targetClass: op.target_class,
          });
        }
        entries[idx].periods[slotIdx].class = null;
        if (op.reason) entries[idx].periods[slotIdx].reason = op.reason;
        audit.push({
          id: nanoid(), level: "info", message: "clear_period_class",
          date: op.date, period: op.period, opType: op.op, before, after: null,
        });
        break;
      }
      case "set_period_class": {
        if (op.period === undefined) break;
        const slotIdx = entries[idx].periods.findIndex(p => p.period === op.period);
        if (slotIdx === -1) break;
        const before = entries[idx].periods[slotIdx].class;
        if (op.target_class && before !== op.target_class) {
          audit.push({
            id: nanoid(), level: "warn",
            message: `target_class mismatch: 期待「${op.target_class}」実際「${before ?? "null"}」`,
            date: op.date, period: op.period, opType: op.op,
            before, targetClass: op.target_class,
          });
        }
        entries[idx].periods[slotIdx].class = op.class ?? null;
        if (op.reason) entries[idx].periods[slotIdx].reason = op.reason;
        audit.push({
          id: nanoid(), level: "info", message: "set_period_class",
          date: op.date, period: op.period, opType: op.op, before, after: op.class ?? null,
        });
        break;
      }
      case "set_period_reason": {
        if (op.period === undefined) break;
        const slotIdx = entries[idx].periods.findIndex(p => p.period === op.period);
        if (slotIdx === -1) break;
        const old = entries[idx].periods[slotIdx].reason;
        if (op.replace || !old) {
          entries[idx].periods[slotIdx].reason = op.reason;
        } else {
          entries[idx].periods[slotIdx].reason = [old, op.reason].filter(Boolean).join("; ");
        }
        audit.push({
          id: nanoid(), level: "info", message: "set_period_reason",
          date: op.date, period: op.period, opType: op.op,
        });
        break;
      }
      case "set_day_reason": {
        if (op.clear_all_classes) {
          entries[idx].periods.forEach(p => {
            p.class = null;
            p.reason = op.reason;
          });
        }
        audit.push({
          id: nanoid(), level: "info",
          message: op.clear_all_classes ? "set_day_reason+clear_all" : "set_day_reason",
          date: op.date, opType: op.op,
        });
        break;
      }
    }
  }

  return { effective: entries, audit };
}

// ─── Override Builders ──────────────────────────────────────────

export function buildDeleteOp(
  date: string, period: number, currentClass: string | null, reason?: string
): OverrideOp {
  return {
    id: nanoid(),
    op: "clear_period_class", date, period,
    target_class: currentClass,
    reason: reason || undefined,
  };
}

export function buildAddOp(
  date: string, period: number, newClass: string, reason?: string
): OverrideOp {
  return {
    id: nanoid(),
    op: "set_period_class", date, period,
    class: newClass,
    reason: reason || undefined,
  };
}

export function buildMoveOps(
  srcDate: string, srcPeriod: number, srcClass: string | null,
  dstDate: string, dstPeriod: number, dstClass: string | null,
  reason?: string
): OverrideOp[] {
  return [
    { id: nanoid(), op: "clear_period_class", date: srcDate, period: srcPeriod, target_class: srcClass, reason: reason || undefined },
    { id: nanoid(), op: "set_period_class", date: dstDate, period: dstPeriod, class: srcClass, target_class: dstClass, reason: reason || undefined },
  ];
}

export function buildSwapOps(
  aDate: string, aPeriod: number, aClass: string | null,
  bDate: string, bPeriod: number, bClass: string | null,
  reason?: string
): OverrideOp[] {
  return [
    { id: nanoid(), op: "set_period_class", date: aDate, period: aPeriod, class: bClass, target_class: aClass, reason: reason || undefined },
    { id: nanoid(), op: "set_period_class", date: bDate, period: bPeriod, class: aClass, target_class: bClass, reason: reason || undefined },
  ];
}

export function buildReasonOp(
  date: string, period: number, reason: string, replace = true
): OverrideOp {
  return { id: nanoid(), op: "set_period_reason", date, period, reason, replace };
}

// ─── Stats Calculation ──────────────────────────────────────────

export function calcClassStats(
  entries: TimetableEntry[], asOf: string
): ClassStats[] {
  const totalMap = new Map<string, number>();
  const completedMap = new Map<string, number>();

  for (const entry of entries) {
    for (const slot of entry.periods) {
      if (!slot.class) continue;
      totalMap.set(slot.class, (totalMap.get(slot.class) ?? 0) + 1);
      if (entry.date <= asOf) {
        completedMap.set(slot.class, (completedMap.get(slot.class) ?? 0) + 1);
      }
    }
  }

  return Array.from(totalMap.keys()).sort().map(cls => {
    const total = totalMap.get(cls) ?? 0;
    const completed = completedMap.get(cls) ?? 0;
    return {
      class: cls,
      grade: cls.slice(0, 2),
      totalPeriods: total,
      completedPeriods: completed,
      remainingPeriods: total - completed,
      completionRate: total > 0 ? completed / total : 0,
      asOfDate: asOf,
    };
  });
}

// ─── Week Navigation ────────────────────────────────────────────

export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekDates(
  monday: Date,
  options: { includeSaturday?: boolean; includeSunday?: boolean } = {}
): string[] {
  const { includeSaturday = false, includeSunday = false } = options;
  const dates: string[] = [];
  // Mon-Fri (0-4)
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    dates.push(formatDate(d));
  }
  // Saturday (+5)
  if (includeSaturday) {
    const sat = new Date(monday);
    sat.setDate(sat.getDate() + 5);
    dates.push(formatDate(sat));
  }
  // Sunday (+6)
  if (includeSunday) {
    const sun = new Date(monday);
    sun.setDate(sun.getDate() + 6);
    dates.push(formatDate(sun));
  }
  return dates;
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return formatDate(new Date());
}

export function formatDateJP(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const wd = weekdays[d.getDay()];
  return `${m}/${day}（${wd}）`;
}

// ─── Validation ─────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateOp(op: OverrideOp): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(op.date)) {
    errors.push(`無効な日付形式: ${op.date}（YYYY-MM-DD 形式で入力してください）`);
  }
  if (op.period !== undefined && !VALID_PERIODS.includes(op.period as typeof VALID_PERIODS[number])) {
    errors.push(`無効な時限: ${op.period}（1〜6のみ有効）`);
  }
  if (op.class && !VALID_CLASSES.includes(op.class)) {
    warnings.push(`標準外のクラス名: ${op.class}`);
  }

  return { valid: errors.length === 0, warnings, errors };
}

// ─── Export Builders ────────────────────────────────────────────

export function buildEffectiveJSON(entries: TimetableEntry[]): EffectiveBundle {
  return { by_date: entries };
}

export function buildOverrideJSON(
  ops: OverrideOp[], baseMeta?: Partial<OverrideBundle>
): OverrideBundle {
  return {
    schema: "timetable-override/v1",
    generated_at: new Date().toISOString(),
    base: baseMeta?.base ?? "",
    notes: baseMeta?.notes,
    ops,
  };
}

export function toCSV(
  entries: TimetableEntry[],
  options?: { holidayMap?: Map<string, string> }
): string {
  const { holidayMap } = options ?? {};
  const lines = ["date,weekday,weekday_jp,period,class,reason"];
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of sorted) {
    const holidayName = holidayMap?.get(entry.date);
    for (const slot of entry.periods.sort((a, b) => a.period - b.period)) {
      // Append holiday name to reason if this date is a holiday/school-off day
      let reason = slot.reason ?? "";
      if (holidayName) {
        reason = reason ? `${reason}; ${holidayName}` : holidayName;
      }
      lines.push(
        `${entry.date},${entry.weekday},${entry.weekday_jp},${slot.period},${slot.class ?? ""},${reason}`
      );
    }
  }
  return lines.join("\n");
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
