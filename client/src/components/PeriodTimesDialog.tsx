// Design: Swiss Grid × Japanese Functional Design
// PeriodTimesDialog: 時程表（各コマの開始・終了時刻）設定ダイアログ
// 一括設定（全曜日共通）と曜日別設定（曜日ごとに異なる時刻）の両方に対応

import { useState, useEffect } from "react";
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

const WEEKDAYS_DEF = [
  { key: "mon", label: "月" },
  { key: "tue", label: "火" },
  { key: "wed", label: "水" },
  { key: "thu", label: "木" },
  { key: "fri", label: "金" },
  { key: "sat", label: "土" },
  { key: "sun", label: "日" },
];

type PeriodTimeMap = Record<number, { start: string; end: string }>;
type PeriodTimeByDayMap = Record<string, PeriodTimeMap>;

// ─── 共通の時程入力グリッドコンポーネント ───────────────────────

interface PeriodGridProps {
  times: PeriodTimeMap;
  onChange: (period: number, field: "start" | "end", value: string) => void;
}

function PeriodGrid({ times, onChange }: PeriodGridProps) {
  const getRowError = (period: number): string | null => {
    const t = times[period];
    if (!t?.start || !t?.end) return null;
    if (t.start >= t.end) return "開始が終了以降になっています";
    return null;
  };

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-2 px-1">
        <span className="text-[10px] text-muted-foreground font-medium text-center">コマ</span>
        <span className="text-[10px] text-muted-foreground font-medium text-center">開始</span>
        <span className="text-[10px] text-muted-foreground font-medium text-center">終了</span>
      </div>
      {PERIODS.map(period => {
        const t = times[period] ?? { start: "", end: "" };
        const err = getRowError(period);
        return (
          <div key={period} className="space-y-0.5">
            <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-2 items-center">
              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-foreground/70">{period}</span>
                <span className="text-[9px] text-muted-foreground/50">限</span>
              </div>
              <input
                type="time"
                value={t.start}
                onChange={e => onChange(period, "start", e.target.value)}
                className={cn(
                  "w-full h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  err ? "border-destructive" : "border-input"
                )}
              />
              <input
                type="time"
                value={t.end}
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
  const [useDayMode, setUseDayMode] = useState(false);
  const [sharedTimes, setSharedTimes] = useState<PeriodTimeMap>({ ...DEFAULT_PERIOD_TIMES });
  const [byDayTimes, setByDayTimes] = useState<PeriodTimeByDayMap>({});
  const [selectedDay, setSelectedDay] = useState("mon");
  const [isDirty, setIsDirty] = useState(false);

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
          <p className="text-sm font-medium">曜日ごとに時程が異なる</p>
          <p className="text-xs text-muted-foreground">水曜日だけ短縮授業など、曜日別に個別設定できます</p>
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
            <p className="text-xs text-muted-foreground font-medium">全曜日共通の時程</p>
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={handleResetShared}>
              <RotateCcw size={10} />
              デフォルトに戻す
            </Button>
          </div>
          <PeriodGrid times={sharedTimes} onChange={handleSharedChange} />
        </div>
      ) : (
        /* 曜日別設定モード */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium">曜日を選んで個別設定</p>
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={handleCopySharedToAll}>
              <RotateCcw size={10} />
              全曜日に共通設定を適用
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
                {WEEKDAYS_DEF.find(d => d.key === selectedDay)?.label}曜日の時程
              </p>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={() => handleCopySharedToDay(selectedDay)}>
                  <ChevronDown size={10} />
                  共通設定をコピー
                </Button>
                <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={() => handleResetDay(selectedDay)}>
                  <RotateCcw size={10} />
                  デフォルト
                </Button>
              </div>
            </div>
            <PeriodGrid
              times={currentDayTimes}
              onChange={(period, field, value) => handleDayChange(selectedDay, period, field, value)}
            />
          </div>

          {/* 共通設定（折りたたみ参照用） */}
          <details className="group">
            <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none list-none">
              <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
              全曜日共通の基準時程を編集
            </summary>
            <div className="mt-2 pl-2 border-l-2 border-border space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">共通時程（各曜日の「共通設定をコピー」の元になります）</p>
                <Button variant="ghost" size="sm" className="text-xs gap-1 h-6" onClick={handleResetShared}>
                  <RotateCcw size={10} />
                  デフォルト
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
          <span>ICS書き出しで正確な時刻が反映されます</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleSave}
            disabled={!canSave}
          >
            <Check size={13} />
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── 通常版（TimetableContext依存） ──────────────────────────────

export function PeriodTimesDialog({ open, onOpenChange }: PeriodTimesDialogProps) {
  const { semester, updateSettings } = useTimetable();

  const handleSave = (times: PeriodTimeMap | undefined, byDay: PeriodTimeByDayMap | undefined) => {
    if (!semester) return;
    updateSettings({ ...semester, periodTimes: times, periodTimesByDay: byDay });
    onOpenChange(false);
  };

  if (!semester) return null;

   const [showLLMDialog, setShowLLMDialog] = useState(false);
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Clock size={18} className="text-primary" />
              時程表の設定
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950/30"
              onClick={() => setShowLLMDialog(true)}
            >
              <Bot size={12} />
              LLM読み取り
            </Button>
          </div>
          <DialogDescription className="text-xs">
            各コマの開始・終了時刻を設定します。曜日ごとに異なる時程にも対応しています。
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
            時程表の設定
          </DialogTitle>
          <DialogDescription className="text-xs">
            各コマの開始・終了時刻を設定します。曜日ごとに異なる時程（水曜短縮など）にも対応しています。
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
