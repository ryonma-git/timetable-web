// Design: Swiss Grid × Japanese Functional Design
// PeriodTimesDialog: 時程表（各コマの開始・終了時刻）設定ダイアログ

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Clock, RotateCcw } from "lucide-react";
import { useTimetable } from "@/contexts/TimetableContext";
import { cn } from "@/lib/utils";

interface PeriodTimesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 一般的な小学校の時程例（デフォルト）
const DEFAULT_PERIOD_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: "08:50", end: "09:35" },
  2: { start: "09:45", end: "10:30" },
  3: { start: "10:50", end: "11:35" },
  4: { start: "11:45", end: "12:30" },
  5: { start: "13:50", end: "14:35" },
  6: { start: "14:50", end: "15:30" },
};

const PERIODS = [1, 2, 3, 4, 5, 6];

export function PeriodTimesDialog({ open, onOpenChange }: PeriodTimesDialogProps) {
  const { semester, updateSettings } = useTimetable();
  const [localTimes, setLocalTimes] = useState<Record<number, { start: string; end: string }>>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (open) {
      // 既存の設定があればそれを使う、なければデフォルト
      const existing = semester?.periodTimes;
      if (existing && Object.keys(existing).length > 0) {
        setLocalTimes({ ...existing });
      } else {
        setLocalTimes({ ...DEFAULT_PERIOD_TIMES });
      }
      setIsDirty(false);
    }
  }, [open, semester?.periodTimes]);

  const handleTimeChange = (period: number, field: "start" | "end", value: string) => {
    setLocalTimes(prev => ({
      ...prev,
      [period]: { ...prev[period], [field]: value },
    }));
    setIsDirty(true);
  };

  const handleReset = () => {
    setLocalTimes({ ...DEFAULT_PERIOD_TIMES });
    setIsDirty(true);
  };

  const handleClear = () => {
    setLocalTimes({});
    setIsDirty(true);
  };

  const handleSave = () => {
    if (!semester) return;
    // 空の場合はundefinedに
    const hasAnyTime = Object.values(localTimes).some(t => t.start || t.end);
    const newSemester = {
      ...semester,
      periodTimes: hasAnyTime ? localTimes : undefined,
    };
    updateSettings(newSemester);
    setIsDirty(false);
    onOpenChange(false);
  };

  // 時刻の妥当性チェック（start < end）
  const getRowError = (period: number): string | null => {
    const t = localTimes[period];
    if (!t?.start || !t?.end) return null;
    if (t.start >= t.end) return "開始が終了以降になっています";
    return null;
  };

  const hasErrors = PERIODS.some(p => getRowError(p) !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock size={18} className="text-primary" />
            時程表の設定
          </DialogTitle>
          <DialogDescription className="text-xs">
            各コマの開始・終了時刻を設定します。設定するとICS形式（Googleカレンダー用）でのエクスポートが可能になります。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {/* ヘッダー行 */}
          <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 px-1">
            <span className="text-xs text-muted-foreground font-medium text-center">コマ</span>
            <span className="text-xs text-muted-foreground font-medium text-center">開始</span>
            <span className="text-xs text-muted-foreground font-medium text-center">終了</span>
          </div>

          {PERIODS.map(period => {
            const t = localTimes[period] ?? { start: "", end: "" };
            const err = getRowError(period);
            return (
              <div key={period} className="space-y-0.5">
                <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 items-center">
                  <div className="flex flex-col items-center">
                    <span className="text-sm font-bold text-foreground/70">{period}</span>
                    <span className="text-[9px] text-muted-foreground/50">限</span>
                  </div>
                  <input
                    type="time"
                    value={t.start}
                    onChange={e => handleTimeChange(period, "start", e.target.value)}
                    className={cn(
                      "w-full h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                      err ? "border-destructive" : "border-input"
                    )}
                  />
                  <input
                    type="time"
                    value={t.end}
                    onChange={e => handleTimeChange(period, "end", e.target.value)}
                    className={cn(
                      "w-full h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                      err ? "border-destructive" : "border-input"
                    )}
                  />
                </div>
                {err && (
                  <p className="text-[10px] text-destructive pl-14">{err}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
          <Clock size={11} />
          <span>時程を設定するとICS書き出しで正確な時刻が反映されます</span>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={handleReset}>
              <RotateCcw size={11} />
              デフォルトに戻す
            </Button>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleClear}>
              クリア
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleSave}
              disabled={!isDirty || hasErrors}
            >
              <Check size={13} />
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Standalone version (for NewFileWizard, no TimetableContext dependency) ───

interface PeriodTimesDialogStandaloneProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Record<number, { start: string; end: string }> | undefined;
  onChange: (times: Record<number, { start: string; end: string }> | undefined) => void;
}

export function PeriodTimesDialogStandalone({ open, onOpenChange, value, onChange }: PeriodTimesDialogStandaloneProps) {
  const [localTimes, setLocalTimes] = useState<Record<number, { start: string; end: string }>>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (open) {
      if (value && Object.keys(value).length > 0) {
        setLocalTimes({ ...value });
      } else {
        setLocalTimes({ ...DEFAULT_PERIOD_TIMES });
      }
      setIsDirty(false);
    }
  }, [open, value]);

  const handleTimeChange = (period: number, field: "start" | "end", val: string) => {
    setLocalTimes(prev => ({
      ...prev,
      [period]: { ...prev[period], [field]: val },
    }));
    setIsDirty(true);
  };

  const handleReset = () => {
    setLocalTimes({ ...DEFAULT_PERIOD_TIMES });
    setIsDirty(true);
  };

  const handleClear = () => {
    setLocalTimes({});
    setIsDirty(true);
  };

  const handleSave = () => {
    const hasAnyTime = Object.values(localTimes).some(t => t.start || t.end);
    onChange(hasAnyTime ? localTimes : undefined);
    setIsDirty(false);
    onOpenChange(false);
  };

  const getRowError = (period: number): string | null => {
    const t = localTimes[period];
    if (!t?.start || !t?.end) return null;
    if (t.start >= t.end) return "開始が終了以降になっています";
    return null;
  };

  const hasErrors = PERIODS.some(p => getRowError(p) !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock size={18} className="text-primary" />
            時程表の設定
          </DialogTitle>
          <DialogDescription className="text-xs">
            各コマの開始・終了時刻を設定します。設定するとICS形式（Googleカレンダー用）でのエクスポートで正確な時刻が反映されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 px-1">
            <span className="text-xs text-muted-foreground font-medium text-center">コマ</span>
            <span className="text-xs text-muted-foreground font-medium text-center">開始</span>
            <span className="text-xs text-muted-foreground font-medium text-center">終了</span>
          </div>

          {PERIODS.map(period => {
            const t = localTimes[period] ?? { start: "", end: "" };
            const err = getRowError(period);
            return (
              <div key={period} className="space-y-0.5">
                <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 items-center">
                  <div className="flex flex-col items-center">
                    <span className="text-sm font-bold text-foreground/70">{period}</span>
                    <span className="text-[9px] text-muted-foreground/50">限</span>
                  </div>
                  <input
                    type="time"
                    value={t.start}
                    onChange={e => handleTimeChange(period, "start", e.target.value)}
                    className={cn(
                      "w-full h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                      err ? "border-destructive" : "border-input"
                    )}
                  />
                  <input
                    type="time"
                    value={t.end}
                    onChange={e => handleTimeChange(period, "end", e.target.value)}
                    className={cn(
                      "w-full h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                      err ? "border-destructive" : "border-input"
                    )}
                  />
                </div>
                {err && (
                  <p className="text-[10px] text-destructive pl-14">{err}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
          <Clock size={11} />
          <span>時程を設定するとICS書き出しで正確な時刻が反映されます</span>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={handleReset}>
              <RotateCcw size={11} />
              デフォルトに戻す
            </Button>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleClear}>
              クリア
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleSave}
              disabled={!isDirty || hasErrors}
            >
              <Check size={13} />
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
