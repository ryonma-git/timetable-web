// TimetableContext.tsx
// Design: Swiss Grid × Japanese Functional Design
// Global state management for timetable app
// Supports: .timetable (native), ZIP (legacy), new file creation

import React, { createContext, useCallback, useContext, useState } from "react";
import {
  AuditEntry,
  ClassStats,
  OverrideBundle,
  OverrideOp,
  TimetableEntry,
  applyOverrides,
  buildEffectiveJSON,
  buildOverrideJSON,
  calcClassStats,
  downloadFile,
  formatDate,
  getMondayOfWeek,
  toCSV,
  todayISO,
} from "@/lib/timetable";
import {
  TimetableFile,
  SemesterMeta,
  LoadResult,
  ZipImportResult,
  deserializeTimetableFile,
  serializeTimetableFile,
  downloadTimetableFile,
  importFromZip,
  TIMETABLE_FILE_EXT,
} from "@/lib/timetableFile";

// ─── Types ────────────────────────────────────────────────────

export type ActiveTab = "grid" | "stats" | "history" | "audit";

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
  currentFile: TimetableFile | null;
  loadedFileName: string;

  // Semester
  semester: SemesterMeta | null;

  // UI State
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  currentWeekMonday: Date;
  navigateWeek: (delta: number) => void;
  goToToday: () => void;
  selectedCell: { date: string; period: number } | null;
  setSelectedCell: (cell: { date: string; period: number } | null) => void;
  asOfDate: string;
  setAsOfDate: (date: string) => void;
  classStats: ClassStats[];
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
}

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

  const [activeTab, setActiveTab] = useState<ActiveTab>("grid");
  const [currentWeekMonday, setCurrentWeekMonday] = useState(() => getMondayOfWeek(new Date()));
  const [selectedCell, setSelectedCell] = useState<{ date: string; period: number } | null>(null);
  const [asOfDate, setAsOfDate] = useState(todayISO());

  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  // Per-week weekend overrides (temporary Saturday/Sunday classes)
  const [weekendOverrides, setWeekendOverrides] = useState<Record<string, { saturday?: boolean; sunday?: boolean }>>({});

  const toggleWeekendDay = useCallback((weekMonday: string, day: 'saturday' | 'sunday') => {
    setWeekendOverrides(prev => {
      const current = prev[weekMonday] ?? {};
      const key = day === 'saturday' ? 'saturday' : 'sunday';
      return { ...prev, [weekMonday]: { ...current, [key]: !current[key] } };
    });
  }, []);

  // ─── Stats ──────────────────────────────────────────────────
  const classStats = calcClassStats(effectiveEntries, asOfDate);

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
    const csv = toCSV(effectiveEntries);
    const ts = formatDate(new Date()).replace(/-/g, "");
    downloadFile(csv, `timetable_${ts}.csv`, "text/csv;charset=utf-8;");
  }, [effectiveEntries]);

  return (
    <TimetableContext.Provider value={{
      baseEntries, effectiveEntries, pendingOps, allOps, auditLog, overrideMeta,
      isLoaded, isDirty, currentFile, loadedFileName,
      semester: currentFile?.semester ?? null,
      activeTab, setActiveTab,
      currentWeekMonday, navigateWeek, goToToday,
      selectedCell, setSelectedCell,
      asOfDate, setAsOfDate, classStats,
      weekendOverrides, toggleWeekendDay,
      undoStack, redoStack,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undo, redo,
      loadTimetableFile, loadFromNativeFile, loadFromZip,
      saveFile, saveFileAs,
      applyOps,
      exportEffective, exportOverride, exportCSV,
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
