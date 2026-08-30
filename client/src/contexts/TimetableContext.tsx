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
  /** 指定した学期（アクティブでなくてもよい）に直接opsを適用する */
  applyOpsToSemester: (semesterIdx: number, ops: OverrideOp[], description: string) => AuditEntry[];
  /** 日付からその日が属する学期のindexを判定する */
  findSemesterIndexForDate: (dateStr: string) => number;

  // Export
  exportEffective: () => void;
  exportOverride: () => void;
  exportCSV: () => void;

  // Settings
  updateSettings: (newSemester: SemesterMeta, applyFrom?: string, newMode?: TimetableMode, keepOverrides?: boolean) => void;
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

  // ─── Apply Ops to a specific semester（アクティブでない学期にも直接適用） ──
  // 年間予定表LLM取込などで「年度丸ごと」に反映したい場合、日付から所属する学期を
  // 判定し、その学期のops/baseに直接書き込む。アクティブ学期の場合はapplyOpsと
  // 同じ経路（allOps等のライブstateも同期）を通す。
  const applyOpsToSemester = useCallback((semesterIdx: number, ops: OverrideOp[], description: string): AuditEntry[] => {
    if (!currentFile?.semesters || !currentFile.semesters[semesterIdx]) return [];
    if (semesterIdx === activeSemesterIndex) {
      // アクティブ学期はapplyOpsと同じロジックを使う（stateの二重管理を避ける）
      const newAllOps = [...allOps, ...ops];
      const { effective, audit } = applyOverrides(baseEntries, newAllOps);
      const histEntry: HistoryEntry = { ops, description, timestamp: new Date().toISOString() };
      setAllOps(newAllOps);
      setPendingOps(prev => [...prev, ...ops]);
      setEffectiveEntries(effective);
      setAuditLog(prev => [...prev, ...audit]);
      setUndoStack(prev => [...prev, histEntry]);
      setRedoStack([]);
      setIsDirty(true);
      // semesters配列側も同期
      setCurrentFile(prev => {
        if (!prev?.semesters) return prev;
        const semesters = prev.semesters.map((s, i) => i === semesterIdx ? { ...s, ops: newAllOps } : s);
        return { ...prev, semesters, meta: { ...prev.meta, updatedAt: new Date().toISOString() } };
      });
      return audit;
    }
    // 非アクティブな学期: その学期のbase/opsに直接適用し、ライブstateには触れない
    const sem = currentFile.semesters[semesterIdx];
    const newOps = [...(sem.ops ?? []), ...ops];
    const { audit } = applyOverrides(sem.base, newOps);
    setCurrentFile(prev => {
      if (!prev?.semesters) return prev;
      const semesters = prev.semesters.map((s, i) => i === semesterIdx ? { ...s, ops: newOps } : s);
      return { ...prev, semesters, meta: { ...prev.meta, updatedAt: new Date().toISOString() } };
    });
    setIsDirty(true);
    return audit;
  }, [currentFile, activeSemesterIndex, allOps, baseEntries]);

  // 日付がどの学期に属するかを判定する（学期のstartDate〜endDateで判定）
  const findSemesterIndexForDate = useCallback((dateStr: string): number => {
    if (!currentFile?.semesters || currentFile.semesters.length === 0) return 0;
    const idx = currentFile.semesters.findIndex(s =>
      s.semester.startDate && s.semester.endDate &&
      dateStr >= s.semester.startDate && dateStr <= s.semester.endDate
    );
    return idx >= 0 ? idx : activeSemesterIndex;
  }, [currentFile, activeSemesterIndex]);

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
  const updateSettings = useCallback((newSemester: SemesterMeta, applyFrom?: string, newMode?: TimetableMode, keepOverrides?: boolean) => {
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
      // keepOverrides 未指定なら従来通り全保持。明示的に false のときだけ全削除
      newOps = keepOverrides === false ? [] : allOps;
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
      // keepOverrides が true のときは指定日以降の ops も保持。未指定/false は従来通り削除
      newOps = keepOverrides === true ? allOps : allOps.filter(op => op.date < applyFrom);
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
    // 切り替え前に、今アクティブな学期のライブ編集（allOps。currentFile.ops は
    // 明示保存時にしか更新されないため、ここで確実に反映しておかないと
    // 未保存の変更が失われる）を配列に書き戻してから切り替える。
    const flushedSemesters = currentFile.semesters.map((s, i) =>
      i === activeSemesterIndex ? { ...s, base: baseEntries, ops: allOps } : s
    );
    const semData = flushedSemesters[idx];
    const { effective, audit } = applyOverrides(semData.base, semData.ops ?? []);
    setBaseEntries(semData.base);
    setEffectiveEntries(effective);
    setAllOps(semData.ops ?? []);
    setPendingOps([]);
    setAuditLog(audit);
    setUndoStack([]);
    setRedoStack([]);
    setActiveSemesterIndexState(idx);
    // currentFile.semester/base/ops をアクティブ学期のデータに同期させる
    setCurrentFile(prev => prev ? {
      ...prev,
      semesters: flushedSemesters,
      semester: semData.semester,
      base: semData.base,
      ops: semData.ops,
    } : prev);
    // Navigate to start of new semester
    if (semData.semester.startDate) {
      setCurrentWeekMonday(getMondayOfWeek(new Date(semData.semester.startDate + 'T00:00:00')));
    }
  }, [currentFile, activeSemesterIndex, baseEntries, allOps]);

  const addSemester = useCallback((data: SemesterData) => {
    if (!currentFile) return;
    // semesters が [](空配列)のこともある（例: Drive同期時の不具合で書き込まれた
    // 場合など）。空配列は「複数学期化されていない」旧形式ファイルと同じ扱いにし、
    // トップレベルの semester/base/ops から1学期分を復元する。
    // また、現在アクティブな学期のライブ編集（allOps）もここで反映する
    // （currentFile.ops は明示保存時にしか更新されないため）。
    const hasExistingSemesters = !!currentFile.semesters && currentFile.semesters.length > 0;
    const activeMeta = hasExistingSemesters
      ? currentFile.semesters![activeSemesterIndex]?.semester
      : currentFile.semester;
    const existingSemesters: SemesterData[] = hasExistingSemesters
      ? currentFile.semesters!.map((s, i) =>
          i === activeSemesterIndex && activeMeta ? { semester: activeMeta, base: baseEntries, ops: allOps } : s
        )
      : (activeMeta ? [{ semester: activeMeta, base: baseEntries, ops: allOps }] : []);
    const newSemesters = [...existingSemesters, data];
    const updatedFile: TimetableFile = {
      ...currentFile,
      semester: data.semester,
      base: data.base,
      ops: data.ops,
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
  }, [currentFile, activeSemesterIndex, baseEntries, allOps]);

  const removeSemester = useCallback((idx: number) => {
    if (!currentFile?.semesters || currentFile.semesters.length <= 1) return;
    const newSemesters = currentFile.semesters.filter((_, i) => i !== idx);
    // アクティブな学期より前の要素を削除した場合、配列内の位置が1つ前にずれる
    const newIdx = idx < activeSemesterIndex
      ? activeSemesterIndex - 1
      : Math.min(activeSemesterIndex, newSemesters.length - 1);
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
    if (!currentFile) return;
    const sem = currentFile.semester ?? currentFile.semesters?.[activeSemesterIndex]?.semester;
    if (!sem) return;
    const overrides = { ...(sem.weekPatternOverrides ?? {}) };
    if (idx === null) {
      delete overrides[mondayStr];
    } else {
      overrides[mondayStr] = idx;
    }
    const updatedSemester: SemesterMeta = { ...sem, weekPatternOverrides: overrides };
    // semesters配列も同期させる（トップレベルとの二重管理によるデータ食い違いを防ぐ）
    const updatedSemesters = currentFile.semesters && currentFile.semesters.length > 0
      ? currentFile.semesters.map((s, i) => i === activeSemesterIndex ? { ...s, semester: updatedSemester } : s)
      : currentFile.semesters;
    const updatedFile: TimetableFile = {
      ...currentFile,
      semester: updatedSemester,
      ...(updatedSemesters ? { semesters: updatedSemesters } : {}),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile, activeSemesterIndex]);

  // ─── Update holidays ──────────────────────────────────────
  const updateHolidays = useCallback((newHolidays: import("@/lib/timetableFile").HolidayEntry[]) => {
    if (!currentFile) return;
    const sem = currentFile.semester ?? currentFile.semesters?.[activeSemesterIndex]?.semester;
    if (!sem) return;
    const updatedSemester: SemesterMeta = { ...sem, holidays: newHolidays };
    // semesters配列も同期させる（トップレベルとの二重管理によるデータ食い違いを防ぐ）
    const updatedSemesters = currentFile.semesters && currentFile.semesters.length > 0
      ? currentFile.semesters.map((s, i) => i === activeSemesterIndex ? { ...s, semester: updatedSemester } : s)
      : currentFile.semesters;
    const updatedFile: TimetableFile = {
      ...currentFile,
      semester: updatedSemester,
      ...(updatedSemesters ? { semesters: updatedSemesters } : {}),
      meta: { ...currentFile.meta, updatedAt: new Date().toISOString() },
    };
    setCurrentFile(updatedFile);
    setIsDirty(true);
  }, [currentFile, activeSemesterIndex]);

  // ─── Teaching Plan CRUD ──────────────────────────────────────
  // v108: 指導計画は学期ごとに独立させる（base/opsと同じ扱い）。
  // 単元内の通し番号(unitPeriod)は学期内で完結し、2学期から使い始めても
  // 1学期分の授業数でズレることはない。年間を通した進捗を見たい場合は、
  // 全学期分をランタイムでマージして計算する（保存データは分けたまま）。
  //
  // 移行: 旧バージョンではファイル全体で1つのteachingPlans配列を共有していた。
  // まだどの学期にも指導計画が振り分けられていないファイルを開いた場合のみ、
  // 旧データを「学期0（先頭の学期）」に割り当てて表示する。一度でも編集すると
  // その学期のteachingPlansとして確定し、以降トップレベルの値は参照しない。
  const getSemesterTeachingPlans = useCallback((file: TimetableFile, idx: number): GradeSubjectPlan[] => {
    if (!file.semesters || file.semesters.length === 0) {
      return file.teachingPlans ?? [];
    }
    const sem = file.semesters[idx];
    if (sem?.teachingPlans) return sem.teachingPlans;
    // 学期0（先頭学期）自身がまだ一度もteachingPlansを持ったことがない場合だけ、
    // 旧トップレベルデータをフォールバック表示する。
    // 注意: 他の学期の状態は無関係。「ファイル全体でどこかが移行済みか」で
    // 判定すると、2学期側で何か新規追加しただけで1学期側のフォールバックが
    // 無効化され、1学期のデータが消えたように見えるバグになるため、
    // 必ず idx===0 自身の状態だけを見る。
    if (idx === 0) return file.teachingPlans ?? [];
    return [];
  }, []);

  const teachingPlans: GradeSubjectPlan[] = currentFile
    ? getSemesterTeachingPlans(currentFile, activeSemesterIndex)
    : [];

  // 指導計画を更新する共通ヘルパー。学期配列があればその学期のteachingPlansへ、
  // なければ（単一学期ファイル）トップレベルへ書き込む。
  const withUpdatedTeachingPlans = useCallback((
    file: TimetableFile,
    idx: number,
    updater: (plans: GradeSubjectPlan[]) => GradeSubjectPlan[]
  ): TimetableFile => {
    if (file.semesters && file.semesters.length > 0) {
      const current = getSemesterTeachingPlans(file, idx);
      const next = updater(current);
      const semesters = file.semesters.map((s, i) => i === idx ? { ...s, teachingPlans: next } : s);
      return { ...file, semesters };
    }
    const next = updater(file.teachingPlans ?? []);
    return { ...file, teachingPlans: next };
  }, [getSemesterTeachingPlans]);

  const upsertTeachingPlan = useCallback((plan: GradeSubjectPlan) => {
    // 関数型更新: ループで連続呼び出ししても古いstateを上書きせず正しく蓄積する
    setCurrentFile(prev => {
      if (!prev) return prev;
      return withUpdatedTeachingPlans(prev, activeSemesterIndex, existing => {
        const idx = existing.findIndex(p => p.id === plan.id);
        return idx >= 0
          ? existing.map((p, i) => i === idx ? plan : p)
          : [...existing, plan];
      });
    });
    setIsDirty(true);
  }, [activeSemesterIndex, withUpdatedTeachingPlans]);

  const removeTeachingPlan = useCallback((id: string) => {
    if (!currentFile) return;
    const updated = withUpdatedTeachingPlans(currentFile, activeSemesterIndex, existing => existing.filter(p => p.id !== id));
    setCurrentFile({ ...updated, meta: { ...updated.meta, updatedAt: new Date().toISOString() } });
    setIsDirty(true);
  }, [currentFile, activeSemesterIndex, withUpdatedTeachingPlans]);

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
    const updated = withUpdatedTeachingPlans(currentFile, activeSemesterIndex, existing =>
      existing.map(p => p.id === planId ? { ...p, lessons } : p)
    );
    setCurrentFile({ ...updated, meta: { ...updated.meta, updatedAt: new Date().toISOString() } });
    setIsDirty(true);
  }, [currentFile, activeSemesterIndex, withUpdatedTeachingPlans]);

  const updateTeachingPlanUnits = useCallback((planId: string, units: TeachingUnit[]) => {
    if (!currentFile) return;
    const updated = withUpdatedTeachingPlans(currentFile, activeSemesterIndex, existing =>
      existing.map(p => p.id === planId ? { ...p, units } : p)
    );
    setCurrentFile({ ...updated, meta: { ...updated.meta, updatedAt: new Date().toISOString() } });
    setIsDirty(true);
  }, [currentFile, activeSemesterIndex, withUpdatedTeachingPlans]);

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
      applyOpsToSemester,
      findSemesterIndexForDate,
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
