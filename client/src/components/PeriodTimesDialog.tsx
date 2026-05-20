// Design: Swiss Grid × Japanese Functional Design
// PeriodTimesDialog: 時程表（各コマの開始・終了時刻）設定ダイアログ
// 一括設定（全曜日共通）と曜日別設定（曜日ごとに異なる時刻）の両方に対応

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Clock, RotateCcw, ChevronDown, Bot } from "lucide-react";
import { LLMImportDialog } from "@/components/LLMImportDialog";
import { useTimetable } from "@/contexts/TimetableContext";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/contexts/LanguageContext";

function wf(t: (k: TranslationKey) => string, key: TranslationKey, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

interface PeriodTimesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// デフォルト時程（勤務先の時程）
export const DEFAULT_PERIOD_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: "08:50", end: "09:35" },
  2: { start: "09:45", end: "10:30" },
  3: { start: "10:50", end: "11:35" },
  4: { start: "11:45", end: "12:30" },
  5: { start: "13:50", end: "14:35" },
  6: { start: "14:50", end: "15:30" },
};

export const PERIODS = [1, 2, 3, 4, 5, 6];

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

type PeriodTimeMap = Record<number, { start: string; end: string }>;
type PeriodTimeByDayMap = Record<string, PeriodTimeMap>;

// ─── 共通の時程入力グリッドコンポーネント ───────────────────────

interface PeriodGridProps {
  times: PeriodTimeMap;
  onChange: (period: number, field: "start" | "end", value: string) => void;
}

function PeriodGrid({ times, onChange }: PeriodGridProps) {
  const { t } = useLanguage();
  const getRowError = (period: number): string | null => {
    const entry = times[period];
    if (!entry?.start || !entry?.end) return null;
    if (entry.start >= entry.end) return t("ptime.timeError");
    return null;
  };

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-2 px-1">
        <span className="text-[10px] text-muted-foreground font-medium text-center">{t("ptime.colPeriod")}</span>
        <span className="text-[10px] text-muted-foreground font-medium text-center">{t("ptime.colStart")}</span>
        <span className="text-[10px] text-muted-foreground font-medium text-center">{t("ptime.colEnd")}</span>
      </div>
      {PERIODS.map(period => {
        const entry = times[period] ?? { start: "", end: "" };
        const err = getRowError(period);
        return (
          <div key={period} className="space-y-0.5">
            <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-2 items-center">
              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-foreground/70">{period}</span>
                <span className="text-[9px] text-muted-foreground/50">{t("ptime.periodSuffix")}</span>
              </div>
              <input
                type="time"
                value={entry.start}
                onChange={e => onChange(period, "start", e.target.value)}
                className={cn(
                  "w-full h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  err ? "border-destructive" : "border-input"
                )}
              />
              <input
                type="time"
                value={entry.end}
                onChange={e => onChange(period, "end", e.target.value)}
                className={cn(
                  "w-full h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  err ? "border-destructive" : "border-input"
                )}
              />
            </div>
            {err && (
              <p className="text-[10px] text-destructive pl-12">{err}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 逆算補助パネル（共通・曜日別モード共用） ──────────────────────

interface CalcHelperPanelProps {
  onApply: (result: PeriodTimeMap) => void;
  onClose: () => void;
  defaultStart?: string;
}

function CalcHelperPanel({ onApply, onClose, defaultStart = "08:50" }: CalcHelperPanelProps) {
  const { t } = useLanguage();
  const [calcStart, setCalcStart] = useState(defaultStart);
  const [calcPeriodMin, setCalcPeriodMin] = useState(45);
  const [calcBreakMin, setCalcBreakMin] = useState(10);
  const [calcLunchAfter, setCalcLunchAfter] = useState(4);
  const [calcLunchMin, setCalcLunchMin] = useState(60);
  const [calcPeriodCount, setCalcPeriodCount] = useState(6);
  const [calcExtraBreaks, setCalcExtraBreaks] = useState<{ afterPeriod: number; minutes: number }[]>([]);

  const handleAddExtraBreak = () => setCalcExtraBreaks(prev => [...prev, { afterPeriod: 2, minutes: 20 }]);
  const handleRemoveExtraBreak = (idx: number) => setCalcExtraBreaks(prev => prev.filter((_, i) => i !== idx));
  const handleExtraBreakChange = (idx: number, field: "afterPeriod" | "minutes", value: number) =>
    setCalcExtraBreaks(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b));

  const handleCalcApply = () => {
    const [h, m] = calcStart.split(":").map(Number);
    let cursor = h * 60 + m;
    const result: PeriodTimeMap = {};
    const toHHMM = (mins: number) => {
      const hh = Math.floor(mins / 60).toString().padStart(2, "0");
      const mm = (mins % 60).toString().padStart(2, "0");
      return `${hh}:${mm}`;
    };
    for (let i = 1; i <= calcPeriodCount; i++) {
      const startMin = cursor;
      const endMin = cursor + calcPeriodMin;
      result[i] = { start: toHHMM(startMin), end: toHHMM(endMin) };
      cursor = endMin;
      if (i < calcPeriodCount) {
        const extraBreak = calcExtraBreaks.find(b => b.afterPeriod === i);
        if (i === calcLunchAfter) {
          cursor += calcLunchMin;
        } else if (extraBreak) {
          cursor += extraBreak.minutes;
        } else {
          cursor += calcBreakMin;
        }
      }
    }
    onApply(result);
    onClose();
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-3">
      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">{t("ptime.calcTitle")}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t("ptime.calcStartLabel")}</label>
          <input type="time" value={calcStart} onChange={e => setCalcStart(e.target.value)}
            className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t("ptime.calcPeriodMinLabel")}</label>
          <input type="number" min={20} max={90} value={calcPeriodMin} onChange={e => setCalcPeriodMin(Number(e.target.value))}
            className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t("ptime.calcBreakLabel")}</label>
          <input type="number" min={0} max={60} value={calcBreakMin} onChange={e => setCalcBreakMin(Number(e.target.value))}
            className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t("ptime.calcPeriodCountLabel")}</label>
          <input type="number" min={1} max={10} value={calcPeriodCount} onChange={e => setCalcPeriodCount(Number(e.target.value))}
            className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t("ptime.calcLunchAfterLabel")}</label>
          <input type="number" min={1} max={calcPeriodCount - 1} value={calcLunchAfter} onChange={e => setCalcLunchAfter(Number(e.target.value))}
            className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">{t("ptime.calcLunchMinLabel")}</label>
          <input type="number" min={0} max={120} value={calcLunchMin} onChange={e => setCalcLunchMin(Number(e.target.value))}
            className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
      </div>
      {/* 業間休み設定 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">{t("ptime.calcExtraSection")}</p>
          <button
            onClick={handleAddExtraBreak}
            className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-medium rounded border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-800/40 transition-colors text-amber-800 dark:text-amber-300"
          >
            <span className="text-xs">+</span> {t("ptime.calcAddBreak")}
          </button>
        </div>
        {calcExtraBreaks.length === 0 && (
          <p className="text-[10px] text-muted-foreground">{t("ptime.calcNoBreak")}</p>
        )}
        {calcExtraBreaks.map((b, idx) => (
          <div key={idx} className="flex items-center gap-2 p-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10">
            <div className="flex items-center gap-1 flex-1">
              <input
                type="number" min={1} max={calcPeriodCount - 1} value={b.afterPeriod}
                onChange={e => handleExtraBreakChange(idx, "afterPeriod", Number(e.target.value))}
                className="w-12 h-6 rounded border border-input bg-background px-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-[10px] text-muted-foreground">{t("ptime.calcBreakAfterPeriod")}</span>
              <input
                type="number" min={1} max={120} value={b.minutes}
                onChange={e => handleExtraBreakChange(idx, "minutes", Number(e.target.value))}
                className="w-14 h-6 rounded border border-input bg-background px-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-[10px] text-muted-foreground">{t("ptime.calcBreakMinSuffix")}</span>
            </div>
            <button
              onClick={() => handleRemoveExtraBreak(idx)}
              className="text-muted-foreground hover:text-destructive transition-colors text-xs px-1"
            >×</button>
          </div>
        ))}
      </div>
      <Button size="sm" className="w-full gap-1.5 text-xs h-7" onClick={handleCalcApply}>
        <Check size={12} />
        {t("ptime.calcApplyBtn")}
      </Button>
      <p className="text-[10px] text-amber-700 dark:text-amber-400">{t("ptime.calcNote")}</p>
    </div>
  );
}

function hasGridErrors(times: PeriodTimeMap): boolean {
  return PERIODS.some(p => {
    const t = times[p];
    if (!t?.start || !t?.end) return false;
    return t.start >= t.end;
  });
}

// ─── 共通ロジック（通常版・スタンドアロン版で共有） ───────────────

interface PeriodTimesInnerProps {
  initialTimes: PeriodTimeMap;
  initialByDay: PeriodTimeByDayMap;
  hasSaturday?: boolean;
  hasSunday?: boolean;
  onSave: (times: PeriodTimeMap | undefined, byDay: PeriodTimeByDayMap | undefined) => void;
  onCancel: () => void;
}

function PeriodTimesInner({ initialTimes, initialByDay, hasSaturday, hasSunday, onSave, onCancel }: PeriodTimesInnerProps) {
  const { t } = useLanguage();
  const weekdayLabels = t("ptime.weekdays").split(",");
  const WEEKDAYS_DEF = useMemo(
    () => WEEKDAY_KEYS.map((key, i) => ({ key, label: weekdayLabels[i] })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekdayLabels.join(",")]
  );
  const [useDayMode, setUseDayMode] = useState(false);
  const [sharedTimes, setSharedTimes] = useState<PeriodTimeMap>({ ...DEFAULT_PERIOD_TIMES });
  const [byDayTimes, setByDayTimes] = useState<PeriodTimeByDayMap>({});
  const [selectedDay, setSelectedDay] = useState("mon");
  const [isDirty, setIsDirty] = useState(false);
  // 逆算補助（共通モード・曜日別モード共用）
  const [showCalcHelper, setShowCalcHelper] = useState(false);
  const [showDayCalcHelper, setShowDayCalcHelper] = useState(false);

  useEffect(() => {
    // 初期値をセット
    const hasShared = Object.keys(initialTimes).length > 0;
    const hasByDay = Object.keys(initialByDay).length > 0;
    if (hasByDay) {
      setUseDayMode(true);
      setByDayTimes({ ...initialByDay });
      // 共通もセット（デフォルト or 既存）
      setSharedTimes(hasShared ? { ...initialTimes } : { ...DEFAULT_PERIOD_TIMES });
    } else if (hasShared) {
      setUseDayMode(false);
      setSharedTimes({ ...initialTimes });
      setByDayTimes({});
    } else {
      setUseDayMode(false);
      setSharedTimes({ ...DEFAULT_PERIOD_TIMES });
      setByDayTimes({});
    }
    setIsDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableDays = WEEKDAYS_DEF.filter(d => {
    if (d.key === "sat" && !hasSaturday) return false;
    if (d.key === "sun" && !hasSunday) return false;
    return true;
  });

  const handleSharedChange = (period: number, field: "start" | "end", value: string) => {
    setSharedTimes(prev => ({ ...prev, [period]: { ...prev[period], [field]: value } }));
    setIsDirty(true);
  };

  const handleDayChange = (day: string, period: number, field: "start" | "end", value: string) => {
    setByDayTimes(prev => ({
      ...prev,
      [day]: { ...(prev[day] ?? {}), [period]: { ...(prev[day]?.[period] ?? { start: "", end: "" }), [field]: value } },
    }));
    setIsDirty(true);
  };

  const handleCopySharedToDay = (day: string) => {
    setByDayTimes(prev => ({ ...prev, [day]: { ...sharedTimes } }));
    setIsDirty(true);
  };

  const handleCopySharedToAll = () => {
    const newByDay: PeriodTimeByDayMap = {};
    availableDays.forEach(d => { newByDay[d.key] = { ...sharedTimes }; });
    setByDayTimes(newByDay);
    setIsDirty(true);
  };

  const handleResetShared = () => {
    setSharedTimes({ ...DEFAULT_PERIOD_TIMES });
    setIsDirty(true);
  };

  const handleResetDay = (day: string) => {
    setByDayTimes(prev => ({ ...prev, [day]: { ...DEFAULT_PERIOD_TIMES } }));
    setIsDirty(true);
  };

  const handleToggleDayMode = (on: boolean) => {
    setUseDayMode(on);
    if (on && Object.keys(byDayTimes).length === 0) {
      // 曜日別に切り替えた際、共通設定を全曜日にコピー
      const newByDay: PeriodTimeByDayMap = {};
      availableDays.forEach(d => { newByDay[d.key] = { ...sharedTimes }; });
      setByDayTimes(newByDay);
    }
    setIsDirty(true);
  };

  const hasAnySharedTime = Object.values(sharedTimes).some(t => t.start || t.end);
  const sharedHasErrors = hasGridErrors(sharedTimes);
  const dayHasErrors = useDayMode && availableDays.some(d => hasGridErrors(byDayTimes[d.key] ?? {}));
  const canSave = isDirty && !sharedHasErrors && !dayHasErrors;

  const handleSave = () => {
    if (useDayMode) {
      const cleanByDay: PeriodTimeByDayMap = {};
      availableDays.forEach(d => {
        const dayMap = byDayTimes[d.key];
        if (dayMap && Object.values(dayMap).some(t => t.start || t.end)) {
          cleanByDay[d.key] = dayMap;
        }
      });
      const hasByDay = Object.keys(cleanByDay).length > 0;
      onSave(
        hasAnySharedTime ? sharedTimes : undefined,
        hasByDay ? cleanByDay : undefined
      );
    } else {
      onSave(hasAnySharedTime ? sharedTimes : undefined, undefined);
    }
  };

  const currentDayTimes = byDayTimes[selectedDay] ?? { ...sharedTimes };

  return (
    <div className="flex flex-col gap-4">
      {/* 曜日別モード切り替え */}
      <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
        <div>
          <p className="text-sm font-medium">{t("ptime.dayModeLabel")}</p>
          <p className="text-xs text-muted-foreground">{t("ptime.dayModeDesc")}</p>
        </div>
        <button
          onClick={() => handleToggleDayMode(!useDayMode)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            useDayMode ? "bg-primary" : "bg-input"
          )}
        >
          <span className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
            useDayMode ? "translate-x-4" : "translate-x-0"
          )} />
        </button>
      </div>

      {!useDayMode ? (
        /* 一括設定モード */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium">{t("ptime.allDayLabel")}</p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={() => setShowCalcHelper(v => !v)}>
                <Clock size={10} />
                {t("ptime.calcBtn")}
              </Button>
              <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={handleResetShared}>
                <RotateCcw size={10} />
                {t("ptime.resetBtn")}
              </Button>
            </div>
          </div>
          {/* 逆算補助パネル（CalcHelperPanel） */}
          {showCalcHelper && (
            <CalcHelperPanel
              onApply={(result) => { setSharedTimes(result); setIsDirty(true); }}
              onClose={() => setShowCalcHelper(false)}
              defaultStart={sharedTimes[1]?.start || "08:50"}
            />
          )}
          <PeriodGrid times={sharedTimes} onChange={handleSharedChange} />
        </div>
      ) : (
        /* 曜日別設定モード */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium">{t("ptime.daySelectLabel")}</p>
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={handleCopySharedToAll}>
              <RotateCcw size={10} />
              {t("ptime.copyToAllBtn")}
            </Button>
          </div>

          {/* 曜日タブ */}
          <div className="flex gap-1 flex-wrap">
            {availableDays.map(d => {
              const hasDayData = byDayTimes[d.key] && Object.values(byDayTimes[d.key]).some(t => t.start || t.end);
              const isCustom = hasDayData && JSON.stringify(byDayTimes[d.key]) !== JSON.stringify(sharedTimes);
              return (
                <button
                  key={d.key}
                  onClick={() => setSelectedDay(d.key)}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium border transition-all",
                    selectedDay === d.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : isCustom
                        ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                        : "bg-background text-muted-foreground border-border hover:bg-muted"
                  )}
                >
                  {d.label}
                  {isCustom && <span className="ml-1 text-[8px]">●</span>}
                </button>
              );
            })}
          </div>

          {/* 選択中の曜日の設定 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">
                {wf(t, "ptime.dayScheduleTitle", { day: WEEKDAYS_DEF.find(d => d.key === selectedDay)?.label ?? selectedDay })}
              </p>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={() => { setShowDayCalcHelper(v => !v); }}>
                  <Clock size={10} />
                  {t("ptime.calcBtn")}
                </Button>
                <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={() => handleCopySharedToDay(selectedDay)}>
                  <ChevronDown size={10} />
                  {t("ptime.copyFromSharedBtn")}
                </Button>
                <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={() => handleResetDay(selectedDay)}>
                  <RotateCcw size={10} />
                  {t("ptime.resetBtn")}
                </Button>
              </div>
            </div>
            {/* 逆算補助パネル（曜日別モード） */}
            {showDayCalcHelper && (
              <CalcHelperPanel
                onApply={(result) => { setByDayTimes(prev => ({ ...prev, [selectedDay]: result })); setIsDirty(true); }}
                onClose={() => setShowDayCalcHelper(false)}
                defaultStart={currentDayTimes[1]?.start || "08:50"}
              />
            )}
            <PeriodGrid
              times={currentDayTimes}
              onChange={(period, field, value) => handleDayChange(selectedDay, period, field, value)}
            />
          </div>

          {/* 共通設定（折りたたみ参照用） */}
          <details className="group">
            <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none list-none">
              <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
              {t("ptime.expandSharedLabel")}
            </summary>
            <div className="mt-2 pl-2 border-l-2 border-border space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">{t("ptime.sharedRefNote")}</p>
                <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={handleResetShared}>
                  <RotateCcw size={10} />
                  {t("ptime.resetBtn")}
                </Button>
              </div>
              <PeriodGrid times={sharedTimes} onChange={handleSharedChange} />
            </div>
          </details>
        </div>
      )}

      {/* フッター */}
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={11} />
          <span>{t("ptime.icsNote")}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onCancel}>
            {t("wiz.cancel")}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleSave}
            disabled={!canSave}
          >
            <Check size={13} />
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── 通常版（TimetableContext依存） ──────────────────────────────

export function PeriodTimesDialog({ open, onOpenChange }: PeriodTimesDialogProps) {
  const { semester, updateSettings } = useTimetable();
  const { t } = useLanguage();
  const [showLLMDialog, setShowLLMDialog] = useState(false);

  const handleSave = (times: PeriodTimeMap | undefined, byDay: PeriodTimeByDayMap | undefined) => {
    if (!semester) return;
    updateSettings({ ...semester, periodTimes: times, periodTimesByDay: byDay });
    onOpenChange(false);
  };

  if (!semester) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Clock size={18} className="text-primary" />
              {t("ptime.dialogTitle")}
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950/30"
              onClick={() => setShowLLMDialog(true)}
            >
              <Bot size={12} />
              {t("ptime.llmRead")}
            </Button>
          </div>
          <DialogDescription className="text-xs">
            {t("ptime.dialogDesc")}
          </DialogDescription>
        </DialogHeader>
        <PeriodTimesInner
          initialTimes={semester.periodTimes ?? {}}
          initialByDay={semester.periodTimesByDay ?? {}}
          hasSaturday={semester.hasSaturday}
          hasSunday={semester.hasSunday}
          onSave={handleSave}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
    <LLMImportDialog open={showLLMDialog} onOpenChange={setShowLLMDialog} mode="period_times" />
    </>
  );
}
// ─── スタンドアロン版版（NewFileWizard用、TimetableContext非依存） ───

interface PeriodTimesDialogStandaloneProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Record<number, { start: string; end: string }> | undefined;
  valueByDay?: Record<string, Record<number, { start: string; end: string }>> | undefined;
  onChange: (times: Record<number, { start: string; end: string }> | undefined, byDay?: Record<string, Record<number, { start: string; end: string }>> | undefined) => void;
  hasSaturday?: boolean;
  hasSunday?: boolean;
}

export function PeriodTimesDialogStandalone({ open, onOpenChange, value, valueByDay, onChange, hasSaturday, hasSunday }: PeriodTimesDialogStandaloneProps) {
  const { t } = useLanguage();

  const handleSave = (times: PeriodTimeMap | undefined, byDay: PeriodTimeByDayMap | undefined) => {
    onChange(times, byDay);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock size={18} className="text-primary" />
            {t("ptime.dialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("ptime.dialogDescAlt")}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <PeriodTimesInner
            initialTimes={value ?? {}}
            initialByDay={valueByDay ?? {}}
            hasSaturday={hasSaturday}
            hasSunday={hasSunday}
            onSave={handleSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
