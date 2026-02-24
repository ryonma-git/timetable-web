// TimetableContext.tsx
// Design: Swiss Grid × Japanese Functional Design
// Global state management for timetable app

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
import { loadZIPFile } from "@/lib/zipLoader";

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

  // UI State
  isLoaded: boolean;
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

  // Undo/Redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Actions
  loadZIP: (file: File) => Promise<{ warnings: string[]; loadedFiles: string[] }>;
  applyOps: (ops: OverrideOp[], description: string) => AuditEntry[];
  exportEffective: () => void;
  exportOverride: () => void;
  exportCSV: () => void;
  loadedFileName: string;
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
  const [loadedFileName, setLoadedFileName] = useState("");

  const [activeTab, setActiveTab] = useState<ActiveTab>("grid");
  const [currentWeekMonday, setCurrentWeekMonday] = useState(() => getMondayOfWeek(new Date()));
  const [selectedCell, setSelectedCell] = useState<{ date: string; period: number } | null>(null);
  const [asOfDate, setAsOfDate] = useState(todayISO());

  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

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

  // ─── Load ZIP ────────────────────────────────────────────────
  const loadZIP = useCallback(async (file: File) => {
    const result = await loadZIPFile(file);
    setLoadedFileName(file.name);

    const base = result.base.length > 0 ? result.base : result.effective;
    setBaseEntries(base);

    if (result.overrideBundle?.ops?.length) {
      const { effective, audit } = applyOverrides(base, result.overrideBundle.ops);
      setEffectiveEntries(effective);
      setAllOps(result.overrideBundle.ops);
      setPendingOps([]);
      setAuditLog(audit);
      setOverrideMeta({
        base: result.overrideBundle.base,
        notes: result.overrideBundle.notes,
      });
    } else {
      setEffectiveEntries(result.effective.length > 0 ? result.effective : base);
      setAllOps([]);
      setPendingOps([]);
      setAuditLog([]);
    }

    setIsLoaded(true);
    setUndoStack([]);
    setRedoStack([]);

    return { warnings: result.warnings, loadedFiles: result.loadedFiles };
  }, []);

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
      isLoaded, activeTab, setActiveTab,
      currentWeekMonday, navigateWeek, goToToday,
      selectedCell, setSelectedCell,
      asOfDate, setAsOfDate, classStats,
      undoStack, redoStack,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undo, redo,
      loadZIP, applyOps,
      exportEffective, exportOverride, exportCSV,
      loadedFileName,
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
