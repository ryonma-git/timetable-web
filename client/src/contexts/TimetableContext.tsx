// TimetableContext.tsx
// Design: Swiss Grid × Japanese Functional Design
// Global state management for timetable app
// Supports: .timetable (native), ZIP (legacy), new file creation
// Phase 2: 教科管理・モード管理を追加

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  AuditEntry,
  ClassStats,
  SubjectStats,
  OverrideBundle,
  OverrideOp,
  TimetableEntry,
  applyOverrides,
  buildEffectiveJSON,
  buildOverrideJSON,
  calcClassStats,
  calcSubjectStats,
  classSort,
  downloadFile,
  formatDate,
  generateDefaultClasses,
  getMondayOfWeek,
  SchoolType,
  toCSV,
  todayISO,
  VALID_CLASSES,
} from "@/lib/timetable";
import {
  TimetableFile,
  TimetableMode,
  SemesterMeta,
  SemesterData,
  SubjectDef,
  GradeSubjectPlan,
  TeachingUnit,
  LessonPlanEntry,
  LoadResult,
  ZipImportResult,
  deserializeTimetableFile,
  serializeTimetableFile,
  downloadTimetableFile,
  importFromZip,
  generateBaseEntries,
  TIMETABLE_FILE_EXT,
} from "@/lib/timetableFile";

// ─── Types ────────────────────────────────────────────────────

export type ActiveTab = "grid" | "stats" | "history" | "audit" | "teachingPlan";

export interface HistoryEntry {
  ops: OverrideOp[];
  description: string;
  timestamp: string;
}

interface TimetableContextValue {
  // Data
  baseEntries: TimetableEntry[];
  effectiveEntries: TimetableEntry[];
  pendingOps: OverrideOp[];
  allOps: OverrideOp[];
  auditLog: AuditEntry[];
  overrideMeta: Partial<OverrideBundle>;

  // File state
  isLoaded: boolean;
  isDirty: boolean;           // unsaved changes
  lastFileSavedAt: Date | null; // 最後に.timetableファイルをダウンロードした日時
  currentFile: TimetableFile | null;
  loadedFileName: string;

  // Semester
  semester: SemesterMeta | null;

  // Mode
  /** 現在のアプリモード（後方互換: 省略時は 'single_subject'） */
  mode: TimetableMode;
  setMode: (mode: TimetableMode) => void;

  // Subjects
  subjects: SubjectDef[];
  addSubject: (subject: SubjectDef) => void;
  updateSubject: (name: string, updated: SubjectDef) => void;
  removeSubject: (name: string) => void;
  reorderSubjects: (subjects: SubjectDef[]) => void;

  // UI State
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  currentWeekMonday: Date;
  navigateWeek: (delta: number) => void;
  goToToday: () => void;
  goToDate: (date: Date) => void;
  selectedCell: { date: string; period: number } | null;
  setSelectedCell: (cell: { date: string; period: number } | null) => void;
  // Multi-select
  multiSelectMode: boolean;
  setMultiSelectMode: (v: boolean) => void;
  selectedCells: Set<string>; // "date|period" keys
  toggleSelectedCell: (date: string, period: number) => void;
  selectCellRange: (fromDate: string, fromPeriod: number, toDate: string, toPeriod: number, weekDates: string[], periods: number[]) => void;
  clearSelectedCells: () => void;
  asOfDate: string;
  setAsOfDate: (date: string) => void;
  classStats: ClassStats[];
  subjectStats: SubjectStats[];
  /** v103: 祝日マスク済み集計用エントリ（教科フィルタ集計の再計算に使用） */
  statsEntries: TimetableEntry[];
  // Per-week Saturday/Sunday overrides (for temporary weekend classes)
  weekendOverrides: Record<string, { saturday?: boolean; sunday?: boolean }>;
  toggleWeekendDay: (weekMonday: string, day: 'saturday' | 'sunday') => void;

  // Undo/Redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // File Actions
  loadTimetableFile: (file: TimetableFile) => Promise<void>;
  loadFromNativeFile: (file: File) => Promise<{ warnings: string[] }>;
  loadFromZip: (file: File) => Promise<{ warnings: string[]; loadedFiles: string[] }>;
  saveFile: () => void;
  saveFileAs: (filename?: string) => void;

  // Data Actions
  applyOps: (ops: OverrideOp[], description: string) => AuditEntry[];

  // Export
  exportEffective: () => void;
  exportOverride: () => void;
  exportCSV: () => void;

  // Settings
  updateSettings: (newSemester: SemesterMeta, applyFrom?: string, newMode?: TimetableMode) => void;
  /** 特定週のA週/B週を手動上書きする。mondayStr: YYYY-MM-DD, idx: 0=A週 1=B週... nullで上書きをリセット */
  updateWeekPatternOverride: (mondayStr: string, idx: number | null) => void;
  /**
   * 時間割を変えずに週サイクル情報だけを設定する。
   * base/ops は一切変更しない。weekCount=1 の場合は baseSchedules を削除する。
   */
  setWeekCycleOnly: (weekCount: number, weekCycleStart?: string) => void;

  // Custom classes
  customClasses: string[];
  classList: string[];
  holidays: import("@/lib/timetableFile").HolidayEntry[];
  updateHolidays: (holidays: import("@/lib/timetableFile").HolidayEntry[]) => void;

  // Multi-semester
  activeSemesterIndex: number;
  semesterCount: number;
  setActiveSemesterIndex: (idx: number) => void;
  addSemester: (data: SemesterData) => void;
  removeSemester: (idx: number) => void;
  switchToSemester: (idx: number) => void;

  // Teaching Plans（指導計画）
  teachingPlans: GradeSubjectPlan[];
  upsertTeachingPlan: (plan: GradeSubjectPlan) => void;
  removeTeachingPlan: (id: string) => void;
  /** v105 Phase C: 指導計画で非表示の教科名リスト（全学年一括） */
  teachingPlanHiddenSubjects: string[];
  toggleTeachingPlanHiddenSubject: (subject: string) => void;
  /** v107 Phase G: 学年×教科(planId)単位の非表示リスト */
  teachingPlanHiddenCombos: string[];
  toggleTeachingPlanHiddenCombo: (planId: string) => void;
  /** 指導計画のlessons配列を更新（単元・コマ内容の編集） */
  updateTeachingPlanLessons: (planId: string, lessons: LessonPlanEntry[]) => void;
  /** 指導計画のunits配列を更新 */
  updateTeachingPlanUnits: (planId: string, units: TeachingUnit[]) => void;
}

// ─── LocalStorage key ────────────────────────────────────────
const LS_KEY = "timetable_autosave";
const LS_META_KEY = "timetable_autosave_meta";
const LS_LAST_SAVED_KEY = "timetable_last_file_saved";

// ─── Context ─────────────────────────────────────────────────

const TimetableContext = createContext<TimetableContextValue | null>(null);

export function TimetableProvider({ children }: { children: React.ReactNode }) {
  const [baseEntries, setBaseEntries] = useState<TimetableEntry[]>([]);
  const [effectiveEntries, setEffectiveEntries] = useState<TimetableEntry[]>([]);
  const [pendingOps, setPendingOps] = useState<OverrideOp[]>([]);
  const [allOps, setAllOps] = useState<OverrideOp[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [overrideMeta, setOverrideMeta] = useState<Partial<OverrideBundle>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [currentFile, setCurrentFile] = useState<TimetableFile | null>(null);
  const [loadedFileName, setLoadedFileName] = useState("");
  const [lastFileSavedAt, setLastFileSavedAt] = useState<Date | null>(() => {
    const v = localStorage.getItem(LS_LAST_SAVED_KEY);
    return v ? new Date(v) : null;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>("grid");
  const [currentWeekMonday, setCurrentWeekMonday] = useState(() => getMondayOfWeek(new Date()));
  const [selectedCell, setSelectedCell] = useState<{ date: string; period: number } | null>(null);
  // Multi-select
  const [multiSelectMode, setMultiSelectModeState] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const setMultiSelectMode = (v: boolean) => {
    setMultiSelectModeState(v);
    if (!v) setSelectedCells(new Set());
  };
  const toggleSelectedCell = (date: string, period: number) => {
    const key = `${date}|${period}`;
    setSelectedCells(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const selectCellRange = (fromDate: string, fromPeriod: number, toDate: string, toPeriod: number, weekDates: string[], periods: number[]) => {
    const fi = weekDates.indexOf(fromDate);
    const ti = weekDates.indexOf(toDate);
    const minDi = Math.min(fi, ti); const maxDi = Math.max(fi, ti);
    const minP = Math.min(fromPeriod, toPeriod); const maxP = Math.max(fromPeriod, toPeriod);
    const keys = new Set<string>();
    for (let di = minDi; di <= maxDi; di++) {
      for (let p = minP; p <= maxP; p++) {
        keys.add(`${weekDates[di]}|${p}`);
      }
    }
    setSelectedCells(keys);
  };
  const clearSelectedCells = () => setSelectedCells(new Set());
  const [asOfDate, setAsOfDate] = useState(todayISO());

  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  // Multi-semester state
  const [activeSemesterIndex, setActiveSemesterIndexState] = useState(0);

  // Per-week weekend overrides (temporary Saturday/Sunday classes)
  const [weekendOverrides, setWeekendOverrides] = useState<Record<string, { saturday?: boolean; sunday?: boolean }>>({});

  const toggleWeekendDay = useCallback((weekMonday: string, day: 'saturday' | 'sunday') => {
    setWeekendOverrides(prev => {
      const current = prev[weekMonday] ?? {};
      const key = day === 'saturday' ? 'saturday' : 'sunday';
      return { ...prev, [weekMonday]: { ...current, [key]: !current[key] } };
    });
  }, []);
  // ─── Stats ────────────────────────────────────────────
  // 祝日マスクを適用した時数計算用エントリ（祝日日のコマはclass=nullにする）
  const holidayDates = new Set(
    (currentFile?.semester?.holidays ?? []).map(h => typeof h === 'string' ? h : h.date)
  );
  const statsEntries = holidayDates.size > 0
    ? effectiveEntries.map(entry =>
        holidayDates.has(entry.date)
          ? { ...entry, periods: entry.periods.map(p => ({ ...p, class: null, subject: null })) }
          : entry
      )
    : effectiveEntries;
  const classStats = calcClassStats(statsEntries, asOfDate);
  const subjectStats = calcSubjectStats(statsEntries, asOfDate);

  // ─── Navigation ─────────────────────────────────────────────
  const navigateWeek = useCallback((delta: number) => {
    setCurrentWeekMonday(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + delta * 7);
      return d;
    });
  }, []);

  const goToToday = useCallback(() => {
    setCurrentWeekMonday(getMondayOfWeek(new Date()));
  }, []);

  const goToDate = useCallback((date: Date) => {
    setCurrentWeekMonday(getMondayOfWeek(date));
  }, []);

  // ─── Internal: set loaded state ─────────────────────────────
  const _setLoadedState = useCallback((
    file: TimetableFile,
    base: TimetableEntry[],
    effective: TimetableEntry[],
    ops: OverrideOp[],
    audit: AuditEntry[],
    filename: string,
    dirty = false,
  ) => {
    setCurrentFile(file);
    setBaseEntries(base);
    setEffectiveEntries(effective);
    setAllOps(ops);
    setPendingOps([]);
    setAuditLog(audit);
    setOverrideMeta({
      base: file.overrideMeta?.baseRef,
      notes: file.overrideMeta?.notes,
    });
    setIsLoaded(true);
    setIsDirty(dirty);
    setLoadedFileName(filename);
    setUndoStack([]);
    setRedoStack([]);
    // ファイル読み込み時はactiveSemesterIndexをリセット（ファイルの保存値を優先）
    const savedIdx = file.activeSemesterIndex ?? 0;
    setActiveSemesterIndexState(savedIdx);
  }, []);

  // ─── Load from TimetableFile object (new/programmatic) ──────
  const loadTimetableFile = useCallback(async (file: TimetableFile) => {
    const { effective, audit } = applyOverrides(file.base, file.ops ?? []);
    const filename = `${file.meta.title}${TIMETABLE_FILE_EXT}`;
    _setLoadedState(file, file.base, effective, file.ops ?? [], audit, filename, true);
  }, [_setLoadedState]);

  // ─── Load from .timetable file ───────────────────────────────
  const loadFromNativeFile = useCallback(async (file: File): Promise<{ warnings: string[] }> => {
    const text = await file.text();
    const result: LoadResult = deserializeTimetableFile(text);
    const { effective, audit } = applyOverrides(result.file.base, result.file.ops ?? []);
    _setLoadedState(result.file, result.file.base, effective, result.file.ops ?? [], audit, file.name, false);
    return { warnings: result.warnings };
  }, [_setLoadedState]);

  // ─── Load from ZIP (legacy) ──────────────────────────────────
  const loadFromZip = useCallback(async (file: File): Promise<{ warnings: string[]; loadedFiles: string[] }> => {
    const result: ZipImportResult = await importFromZip(file);
    const { effective, audit } = applyOverrides(result.file.base, result.file.ops ?? []);
    _setLoadedState(result.file, result.file.base, effective, result.file.ops ?? [], audit, file.name, true);
    return { warnings: result.warnings, loadedFiles: result.loadedFiles };
  }, [_setLoadedState]);

  // ─── Save (overwrite) ────────────────────────────────────────
  const saveFile = useCallback(() => {
    if (!currentFile) return;
    const updated: TimetableFile = {
      ...currentFile,
      ops: allOps,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    downloadTimetableFile(updated, loadedFileName.endsWith(TIMETABLE_FILE_EXT) ? loadedFileName : undefined);
    setCurrentFile(updated);
    setIsDirty(false);
    const now = new Date();
    setLastFileSavedAt(now);
    localStorage.setItem(LS_LAST_SAVED_KEY, now.toISOString());
  }, [currentFile, allOps, loadedFileName]);

  // ─── Save As ─────────────────────────────────────────────────
  const saveFileAs = useCallback((filename?: string) => {
    if (!currentFile) return;
    const updated: TimetableFile = {
      ...currentFile,
      ops: allOps,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    downloadTimetableFile(updated, filename);
    setCurrentFile(updated);
    setIsDirty(false);
    const now = new Date();
    setLastFileSavedAt(now);
    localStorage.setItem(LS_LAST_SAVED_KEY, now.toISOString());
  }, [currentFile, allOps]);

  // ─── Apply Ops ───────────────────────────────────────────────
  const applyOps = useCallback((ops: OverrideOp[], description: string): AuditEntry[] => {
    const newAllOps = [...allOps, ...ops];
    const { effective, audit } = applyOverrides(baseEntries, newAllOps);

    const histEntry: HistoryEntry = {
      ops,
      description,
      timestamp: new Date().toISOString(),
    };

    setAllOps(newAllOps);
    setPendingOps(prev => [...prev, ...ops]);
    setEffectiveEntries(effective);
    setAuditLog(prev => [...prev, ...audit]);
    setUndoStack(prev => [...prev, histEntry]);
    setRedoStack([]);
    setIsDirty(true);

    return audit;
  }, [allOps, baseEntries]);

  // ─── Undo ────────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    const newUndoStack = undoStack.slice(0, -1);
    const removedCount = last.ops.length;
    const newAllOps = allOps.slice(0, allOps.length - removedCount);
    const newPendingOps = pendingOps.slice(0, pendingOps.length - removedCount);

    const { effective, audit } = applyOverrides(baseEntries, newAllOps);

    setUndoStack(newUndoStack);
    setRedoStack(prev => [...prev, last]);
    setAllOps(newAllOps);
    setPendingOps(newPendingOps);
    setEffectiveEntries(effective);
    setAuditLog(audit);
    setIsDirty(true);
  }, [undoStack, allOps, pendingOps, baseEntries]);

  // ─── Redo ────────────────────────────────────────────────────
  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);
    const newAllOps = [...allOps, ...next.ops];
    const newPendingOps = [...pendingOps, ...next.ops];

    const { effective, audit } = applyOverrides(baseEntries, newAllOps);

    setRedoStack(newRedoStack);
    setUndoStack(prev => [...prev, next]);
    setAllOps(newAllOps);
    setPendingOps(newPendingOps);
    setEffectiveEntries(effective);
    setAuditLog(audit);
    setIsDirty(true);
  }, [redoStack, allOps, pendingOps, baseEntries]);

  // ─── Export ──────────────────────────────────────────────────
  const exportEffective = useCallback(() => {
    const data = buildEffectiveJSON(effectiveEntries);
    const ts = formatDate(new Date()).replace(/-/g, "");
    downloadFile(JSON.stringify(data, null, 2), `effective_${ts}.json`, "application/json");
  }, [effectiveEntries]);

  const exportOverride = useCallback(() => {
    const data = buildOverrideJSON(allOps, overrideMeta);
    const ts = formatDate(new Date()).replace(/-/g, "");
    downloadFile(JSON.stringify(data, null, 2), `override_${ts}.json`, "application/json");
  }, [allOps, overrideMeta]);

  const exportCSV = useCallback(() => {
    // Build holiday map: date -> name (for CSV reason column)
    const rawHolidays = currentFile?.semester?.holidays ?? [];
    const holidayEntries = rawHolidays.map(h => typeof h === 'string' ? { date: h } : h);
    const holidayMap = new Map(holidayEntries.map(h => [h.date, h.name ?? '祝日']));
    const includeSubject = (currentFile?.meta.mode ?? 'single_subject') !== 'single_subject';
    const csv = toCSV(effectiveEntries, { holidayMap, includeSubject });
    const ts = formatDate(new Date()).replace(/-/g, "");
    downloadFile(csv, `timetable_${ts}.csv`, "text/csv;charset=utf-8;");
  }, [effectiveEntries, currentFile]);

  // ─── Update Settings (base rebuild) ─────────────────────────
  const updateSettings = useCallback((newSemester: SemesterMeta, applyFrom?: string, newMode?: TimetableMode) => {
    if (!currentFile) return;

    let newBase: TimetableEntry[];
    let newOps: OverrideOp[];

    if (!applyFrom) {
      // Apply to all: regenerate entire base
      newBase = generateBaseEntries(newSemester.startDate, newSemester.endDate, {
        hasSaturday: newSemester.hasSaturday,
        hasSunday: newSemester.hasSunday,
        baseSchedule: newSemester.baseSchedule,
        subjectSchedule: newSemester.subjectSchedule,
        baseSchedules: newSemester.baseSchedules,
        weekCycleStart: newSemester.weekCycleStart,
      });
      newOps = allOps; // keep existing ops
    } else {
      // Apply from date: rebuild entries from applyFrom onwards
      const beforeEntries = baseEntries.filter(e => e.date < applyFrom);
      const newEntries = generateBaseEntries(applyFrom, newSemester.endDate, {
        hasSaturday: newSemester.hasSaturday,
        hasSunday: newSemester.hasSunday,
        baseSchedule: newSemester.baseSchedule,
        subjectSchedule: newSemester.subjectSchedule,
        baseSchedules: newSemester.baseSchedules,
        weekCycleStart: newSemester.weekCycleStart,
      });
      newBase = [...beforeEntries, ...newEntries];
      // Remove ops that are on or after applyFrom
      newOps = allOps.filter(op => op.date < applyFrom);
    }

    // semesters配列も同期させる（複数学期対応）
    let updatedSemesters = currentFile.semesters;
    if (updatedSemesters && updatedSemesters.length > 0) {
      const idx = activeSemesterIndex;
      updatedSemesters = updatedSemesters.map((s, i) =>
        i === idx ? { ...s, semester: newSemester, base: newBase, ops: newOps } : s
      );
    }
    const updatedFile: TimetableFile = {
      ...currentFile,
      semester: newSemester,
      base: newBase,
      ops: newOps,
      ...(updatedSemesters ? { semesters: updatedSemesters } : {}),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString(), ...(newMode ? { mode: newMode } : {}) },
    };

    const { effective, audit } = applyOverrides(newBase, newOps);
    setCurrentFile(updatedFile);
    setBaseEntries(newBase);
    setEffectiveEntries(effective);
    setAllOps(newOps);
    setPendingOps([]);
    setAuditLog(audit);
    setUndoStack([]);
    setRedoStack([]);
    setIsDirty(true);
  }, [currentFile, baseEntries, allOps, activeSemesterIndex]);

  // ─── Week cycle only (時間割を変えず週サイクル情報だけ設定) ─────────
  const setWeekCycleOnly = useCallback((weekCount: number, weekCycleStart?: string) => {
    if (!currentFile) return;
    const sem = currentFile.semester ?? currentFile.semesters?.[activeSemesterIndex]?.semester;
    if (!sem) return;

    const CYCLE_LABELS = ["A週", "B週", "C週", "D週"];
    const updatedSemester: SemesterMeta = {
      ...sem,
      baseSchedules: weekCount > 1
        ? Array.from({ length: weekCount }, (_, i) => ({
            label: CYCLE_LABELS[i],
            schedule: {} as Record<string, Record<number, string | null>>,
          }))
        : undefined,
      weekCycleStart: weekCount > 1 ? weekCycleStart : undefined,
    };

    // semesters 配列も同期
    let updatedSemesters = currentFile.semesters;
    if (updatedSemesters && updatedSemesters.length > 0) {
      updatedSemesters = updatedSemesters.map((s, i) =>
        i === activeSemesterIndex ? { ...s, semester: updatedSemester } : s
      );
    }

    const updatedFile: TimetableFile = {
      ...currentFile,
      semester: updatedSemester,
      ...(updatedSemesters ? { semesters: updatedSemesters } : {}),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile, activeSemesterIndex]);

  // ─── Mode management ────────────────────────────────────────
  const mode: TimetableMode = currentFile?.meta.mode ?? 'single_subject';

  const setMode = useCallback((newMode: TimetableMode) => {
    if (!currentFile) return;
    const updatedFile: TimetableFile = {
      ...currentFile,
      meta: { ...currentFile.meta, mode: newMode, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile]);

  // ─── Subject management ──────────────────────────────────────
  const subjects: SubjectDef[] = currentFile?.subjects ?? [];

  const addSubject = useCallback((subject: SubjectDef) => {
    if (!currentFile) return;
    const existing = currentFile.subjects ?? [];
    if (existing.some(s => s.name === subject.name)) return;
    const updatedFile: TimetableFile = {
      ...currentFile,
      subjects: [...existing, subject],
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile]);

  const updateSubject = useCallback((name: string, updated: SubjectDef) => {
    if (!currentFile) return;
    const existing = currentFile.subjects ?? [];
    const updatedFile: TimetableFile = {
      ...currentFile,
      subjects: existing.map(s => s.name === name ? updated : s),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile]);

  const removeSubject = useCallback((name: string) => {
    if (!currentFile) return;
    const existing = currentFile.subjects ?? [];
    const updatedFile: TimetableFile = {
      ...currentFile,
      subjects: existing.filter(s => s.name !== name),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile]);

  const reorderSubjects = useCallback((newSubjects: SubjectDef[]) => {
    if (!currentFile) return;
    const updatedFile: TimetableFile = {
      ...currentFile,
      subjects: newSubjects,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile]);

  // ─── Multi-semester management ───────────────────────────────────
  // semesters: [] (空配列) のときは旧フォーマットの semester フィールドで判断する
  const semesterCount = (currentFile?.semesters?.length || 0) > 0
    ? currentFile!.semesters!.length
    : (currentFile?.semester ? 1 : 0);

  const setActiveSemesterIndex = useCallback((idx: number) => {
    if (!currentFile) return;
    setActiveSemesterIndexState(idx);
  }, [currentFile]);

  const switchToSemester = useCallback((idx: number) => {
    if (!currentFile?.semesters || idx < 0 || idx >= currentFile.semesters.length) return;
    const semData = currentFile.semesters[idx];
    const { effective, audit } = applyOverrides(semData.base, semData.ops ?? []);
    setBaseEntries(semData.base);
    setEffectiveEntries(effective);
    setAllOps(semData.ops ?? []);
    setPendingOps([]);
    setAuditLog(audit);
    setUndoStack([]);
    setRedoStack([]);
    setActiveSemesterIndexState(idx);
    // currentFile.semesterをアクティブ学期のデータに同期させる
    setCurrentFile(prev => prev ? { ...prev, semester: semData.semester } : prev);
    // Navigate to start of new semester
    if (semData.semester.startDate) {
      setCurrentWeekMonday(getMondayOfWeek(new Date(semData.semester.startDate + 'T00:00:00')));
    }
  }, [currentFile]);

  const addSemester = useCallback((data: SemesterData) => {
    if (!currentFile) return;
    const existingSemesters = currentFile.semesters ?? (currentFile.semester ? [{
      semester: currentFile.semester,
      base: currentFile.base,
      ops: currentFile.ops,
    }] : []);
    const newSemesters = [...existingSemesters, data];
    const updatedFile: TimetableFile = {
      ...currentFile,
      semesters: newSemesters,
      activeSemesterIndex: newSemesters.length - 1,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
    // Switch to new semester
    const { effective, audit } = applyOverrides(data.base, data.ops ?? []);
    setBaseEntries(data.base);
    setEffectiveEntries(effective);
    setAllOps(data.ops ?? []);
    setPendingOps([]);
    setAuditLog(audit);
    setUndoStack([]);
    setRedoStack([]);
    setActiveSemesterIndexState(newSemesters.length - 1);
  }, [currentFile]);

  const removeSemester = useCallback((idx: number) => {
    if (!currentFile?.semesters || currentFile.semesters.length <= 1) return;
    const newSemesters = currentFile.semesters.filter((_, i) => i !== idx);
    const newIdx = Math.min(activeSemesterIndex, newSemesters.length - 1);
    const updatedFile: TimetableFile = {
      ...currentFile,
      semesters: newSemesters,
      activeSemesterIndex: newIdx,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
    if (idx === activeSemesterIndex) {
      switchToSemester(newIdx);
    } else {
      setActiveSemesterIndexState(newIdx);
    }
  }, [currentFile, activeSemesterIndex, switchToSemester]);

  // ─── Custom classes & class list ───────────────────────────────────
  const customClasses = currentFile?.semester?.customClasses ?? [];
  // classListが保存されていない旧ファイルの場合はschoolType・gradeClassCountsから生成
  const classList = (() => {
    const saved = currentFile?.semester?.classList;
    if (saved && saved.length > 0) return saved;
    // フォールバック: schoolType・gradeClassCountsから動的生成
    const sem = currentFile?.semester;
    if (!sem) return VALID_CLASSES;
    const st = (sem.schoolType as SchoolType | undefined) ?? 'elementary';
    const generated = generateDefaultClasses(st as SchoolType, sem.gradeClassCounts);
    const extras = sem.customClasses ?? [];
    const merged = [...generated, ...extras].sort(classSort);
    return merged.length > 0 ? merged : VALID_CLASSES;
  })();
  // 旧形式対応: string[]をHolidayEntry[]に変換
  const holidays: import("@/lib/timetableFile").HolidayEntry[] = (() => {
    const raw = currentFile?.semester?.holidays;
    if (!raw || raw.length === 0) return [];
    return raw.map(h => typeof h === 'string' ? { date: h } : h);
  })();

  // ─── Auto-save to localStorage ──────────────────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLoaded || !currentFile) return;
    // Debounce: wait 2s after last change before saving
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      try {
        const fileToSave: TimetableFile = {
          ...currentFile,
          ops: allOps,
          meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
        };
        const serialized = serializeTimetableFile(fileToSave);
        localStorage.setItem(LS_KEY, serialized);
        localStorage.setItem(LS_META_KEY, JSON.stringify({
          title: fileToSave.meta.title,
          savedAt: new Date().toISOString(),
          filename: loadedFileName,
        }));
      } catch (e) {
        // localStorage full or unavailable - silently ignore
        console.warn("Auto-save failed:", e);
      }
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [isLoaded, currentFile, allOps, loadedFileName]);

  // ─── Update week pattern override ──────────────────────────
  const updateWeekPatternOverride = useCallback((mondayStr: string, idx: number | null) => {
    if (!currentFile || !currentFile.semester) return;
    const overrides = { ...(currentFile.semester.weekPatternOverrides ?? {}) };
    if (idx === null) {
      delete overrides[mondayStr];
    } else {
      overrides[mondayStr] = idx;
    }
    const updatedSemester: SemesterMeta = { ...currentFile.semester, weekPatternOverrides: overrides };
    const updatedFile: TimetableFile = {
      ...currentFile,
      semester: updatedSemester,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile]);

  // ─── Update holidays ──────────────────────────────────────
  const updateHolidays = useCallback((newHolidays: import("@/lib/timetableFile").HolidayEntry[]) => {
    if (!currentFile) return;
    const updatedSemester: SemesterMeta = { ...currentFile.semester!, holidays: newHolidays };
    const updatedFile: TimetableFile = {
      ...currentFile,
      semester: updatedSemester,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile]);

  // ─── Teaching Plan CRUD ──────────────────────────────────────
  const teachingPlans: GradeSubjectPlan[] = currentFile?.teachingPlans ?? [];

  const upsertTeachingPlan = useCallback((plan: GradeSubjectPlan) => {
    if (!currentFile) return;
    const existing = currentFile.teachingPlans ?? [];
    const idx = existing.findIndex(p => p.id === plan.id);
    const next = idx >= 0
      ? existing.map((p, i) => i === idx ? plan : p)
      : [...existing, plan];
    setCurrentFile({ ...currentFile, teachingPlans: next, meta: { ...currentFile.meta, updatedAt: new Date().toISOString() } });
    setIsDirty(true);
  }, [currentFile]);

  const removeTeachingPlan = useCallback((id: string) => {
    if (!currentFile) return;
    setCurrentFile({
      ...currentFile,
      teachingPlans: (currentFile.teachingPlans ?? []).filter(p => p.id !== id),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    });
    setIsDirty(true);
  }, [currentFile]);

  // v105 Phase C: 指導計画の教科非表示トグル（教科名単位、ファイル保存）
  const teachingPlanHiddenSubjects: string[] = currentFile?.teachingPlanHiddenSubjects ?? [];

  const toggleTeachingPlanHiddenSubject = useCallback((subject: string) => {
    if (!currentFile) return;
    const cur = currentFile.teachingPlanHiddenSubjects ?? [];
    const next = cur.includes(subject) ? cur.filter(s => s !== subject) : [...cur, subject];
    setCurrentFile({
      ...currentFile,
      teachingPlanHiddenSubjects: next,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    });
    setIsDirty(true);
  }, [currentFile]);

  // v107 Phase G: 学年×教科(planId)単位の非表示トグル
  const teachingPlanHiddenCombos: string[] = currentFile?.teachingPlanHiddenCombos ?? [];

  const toggleTeachingPlanHiddenCombo = useCallback((planId: string) => {
    if (!currentFile) return;
    const cur = currentFile.teachingPlanHiddenCombos ?? [];
    const next = cur.includes(planId) ? cur.filter(s => s !== planId) : [...cur, planId];
    setCurrentFile({
      ...currentFile,
      teachingPlanHiddenCombos: next,
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    });
    setIsDirty(true);
  }, [currentFile]);

  const updateTeachingPlanLessons = useCallback((planId: string, lessons: LessonPlanEntry[]) => {
    if (!currentFile) return;
    setCurrentFile({
      ...currentFile,
      teachingPlans: (currentFile.teachingPlans ?? []).map(p => p.id === planId ? { ...p, lessons } : p),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    });
    setIsDirty(true);
  }, [currentFile]);

  const updateTeachingPlanUnits = useCallback((planId: string, units: TeachingUnit[]) => {
    if (!currentFile) return;
    setCurrentFile({
      ...currentFile,
      teachingPlans: (currentFile.teachingPlans ?? []).map(p => p.id === planId ? { ...p, units } : p),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    });
    setIsDirty(true);
  }, [currentFile]);

  return (
    <TimetableContext.Provider value={{
      baseEntries, effectiveEntries, pendingOps, allOps, auditLog, overrideMeta,
      isLoaded, isDirty, lastFileSavedAt, currentFile, loadedFileName,
      semester: currentFile?.semester ?? currentFile?.semesters?.[activeSemesterIndex]?.semester ?? null,
      mode, setMode,
      subjects, addSubject, updateSubject, removeSubject, reorderSubjects,
      activeTab, setActiveTab,
      currentWeekMonday, navigateWeek, goToToday, goToDate,
      selectedCell, setSelectedCell,
      multiSelectMode, setMultiSelectMode, selectedCells, toggleSelectedCell, selectCellRange, clearSelectedCells,
      asOfDate, setAsOfDate, classStats, subjectStats, statsEntries,
      weekendOverrides, toggleWeekendDay,
      undoStack, redoStack,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undo, redo,
      loadTimetableFile, loadFromNativeFile, loadFromZip,
      saveFile, saveFileAs,
      applyOps,
      exportEffective, exportOverride, exportCSV,
      updateSettings,
      setWeekCycleOnly,
      updateWeekPatternOverride,
      customClasses,
      classList,
      holidays,
      updateHolidays,
      activeSemesterIndex,
      semesterCount,
      setActiveSemesterIndex,
      addSemester,
      removeSemester,
      switchToSemester,
      teachingPlans,
      upsertTeachingPlan,
      removeTeachingPlan,
      teachingPlanHiddenSubjects,
      toggleTeachingPlanHiddenSubject,
      teachingPlanHiddenCombos,
      toggleTeachingPlanHiddenCombo,
      updateTeachingPlanLessons,
      updateTeachingPlanUnits,
    }}>
      {children}
    </TimetableContext.Provider>
  );
}

export function useTimetable(): TimetableContextValue {
  const ctx = useContext(TimetableContext);
  if (!ctx) throw new Error("useTimetable must be used within TimetableProvider");
  return ctx;
}
