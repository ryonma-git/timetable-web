// Design: Swiss Grid × Japanese Functional Design
// HolidaySettingsDialog: 祝日自動取得・休校日設定ダイアログ

import { useState, useEffect, useMemo, useCallback } from "react";
import Holidays from "date-holidays";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTimetable } from "@/contexts/TimetableContext";
import type { HolidayEntry } from "@/lib/timetableFile";
import type { OverrideOp } from "@/lib/timetable";
import { CalendarX, Plus, Trash2, RefreshCw, Check } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/contexts/LanguageContext";

interface HolidaySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}


// 学期期間内の祝日を取得する
function getJapaneseHolidaysInRange(startDate: string, endDate: string): { date: string; name: string }[] {
  const hd = new Holidays("JP");
  const start = new Date(startDate);
  const end = new Date(endDate);

  // 対象年度を収集
  const years = new Set<number>();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    years.add(y);
  }

  const result: { date: string; name: string }[] = [];
  years.forEach(year => {
    const holidays = hd.getHolidays(year);
    holidays.forEach(h => {
      if (h.type !== "public") return;
      const d = new Date(h.date);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (iso >= startDate && iso <= endDate) {
        result.push({ date: iso, name: h.name });
      }
    });
  });

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function wf(t: (k: TranslationKey) => string, key: TranslationKey, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function HolidaySettingsDialog({ open, onOpenChange }: HolidaySettingsDialogProps) {
  const { semester, holidays, updateHolidays, effectiveEntries, applyOps } = useTimetable();
  const { t, language } = useLanguage();

  const monthNames = t("hol.months").split(",");
  const weekdayLabels = language === "en"
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["日", "月", "火", "水", "木", "金", "土"];

  const formatDateDisplay = useCallback((iso: string): string => {
    const [y, m, d] = iso.split("-");
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    const wd = weekdayLabels[date.getDay()];
    if (language === "en") {
      return `${monthNames[parseInt(m) - 1]} ${parseInt(d)}, ${y} (${wd})`;
    }
    return `${y}年${parseInt(m)}月${parseInt(d)}日（${wd}）`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // localHolidays は HolidayEntry[] で管理
  const [localHolidays, setLocalHolidays] = useState<HolidayEntry[]>([]);
  const [customDateInput, setCustomDateInput] = useState("");
  const [customDateError, setCustomDateError] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // 確認ダイアログ用の状態
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingOps, setPendingOps] = useState<OverrideOp[]>([]);
  const [pendingHolidays, setPendingHolidays] = useState<HolidayEntry[]>([]);

  // ダイアログを開いたときに現在の休校日を読み込む
  useEffect(() => {
    if (open) {
      setLocalHolidays([...(holidays ?? [])].sort((a, b) => a.date.localeCompare(b.date)));
      setIsDirty(false);
      setCustomDateInput("");
      setCustomDateError("");
    }
  }, [open, holidays]);

  // 祝日の自動取得
  const autoHolidays = useMemo(() => {
    if (!semester?.startDate || !semester?.endDate) return [];
    return getJapaneseHolidaysInRange(semester.startDate, semester.endDate);
  }, [semester?.startDate, semester?.endDate]);

  // 登録済み日付のSet
  const localDates = useMemo(() => new Set(localHolidays.map(h => h.date)), [localHolidays]);

  // 祝日を一括追加（祝日名付き）
  const addAutoHolidays = () => {
    const newEntries = autoHolidays
      .filter(h => !localDates.has(h.date))
      .map(h => ({ date: h.date, name: h.name }));
    if (newEntries.length === 0) return;
    const updated = [...localHolidays, ...newEntries].sort((a, b) => a.date.localeCompare(b.date));
    setLocalHolidays(updated);
    setIsDirty(true);
  };

  // 個別削除
  const removeHoliday = (date: string) => {
    setLocalHolidays(prev => prev.filter(h => h.date !== date));
    setIsDirty(true);
  };

  // 祝日バッジをトグル（祝日名付きで追加）
  const toggleAutoHoliday = (h: { date: string; name: string }) => {
    if (localDates.has(h.date)) {
      removeHoliday(h.date);
    } else {
      setLocalHolidays(prev => [...prev, { date: h.date, name: h.name }].sort((a, b) => a.date.localeCompare(b.date)));
      setIsDirty(true);
    }
  };

  // カスタム日付を追加（名前なし → "休校日"）
  const addCustomDate = () => {
    const val = customDateInput.trim();
    if (!val) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      setCustomDateError(t("hol.errFormat"));
      return;
    }
    if (semester?.startDate && val < semester.startDate) {
      setCustomDateError(t("hol.errBeforeStart"));
      return;
    }
    if (semester?.endDate && val > semester.endDate) {
      setCustomDateError(t("hol.errAfterEnd"));
      return;
    }
    if (localDates.has(val)) {
      setCustomDateError(t("hol.errAlreadyAdded"));
      return;
    }
    setLocalHolidays(prev => [...prev, { date: val }].sort((a, b) => a.date.localeCompare(b.date)));
    setCustomDateInput("");
    setCustomDateError("");
    setIsDirty(true);
  };

  // 新しく追加された祝日の日付について、授業があるコマのOpsを生成する
  const buildClearOpsForNewHolidays = (newHolidays: HolidayEntry[]): OverrideOp[] => {
    const existingDates = new Set((holidays ?? []).map(h => h.date));
    const addedDates = newHolidays.filter(h => !existingDates.has(h.date));

    const ops: OverrideOp[] = [];
    const entryMap = new Map(effectiveEntries.map(e => [e.date, e]));

    for (const holiday of addedDates) {
      const entry = entryMap.get(holiday.date);
      if (!entry) continue;
      for (const slot of entry.periods) {
        if (slot.class !== null && slot.class !== undefined) {
          ops.push({
            id: Math.random().toString(36).slice(2, 10),
            op: "clear_period_class",
            date: holiday.date,
            period: slot.period,
            target_class: slot.class,
            reason: holiday.name ?? "休校日",
            clear_all_classes: false,
          });
        }
      }
    }
    return ops;
  };

  // 保存ボタン押下 → 授業コマがある場合は確認ダイアログを表示
  const handleSave = () => {
    const ops = buildClearOpsForNewHolidays(localHolidays);
    if (ops.length > 0) {
      setPendingOps(ops);
      setPendingHolidays(localHolidays);
      setConfirmOpen(true);
    } else {
      // 削除対象コマなし → そのまま保存
      updateHolidays(localHolidays);
      setIsDirty(false);
      onOpenChange(false);
    }
  };

  // 確認ダイアログ「コマも削除する」
  const handleConfirmWithClear = () => {
    updateHolidays(pendingHolidays);
    applyOps(pendingOps, `祝日設定: ${pendingOps.length}コマを休講に設定`);
    setConfirmOpen(false);
    setIsDirty(false);
    onOpenChange(false);
  };

  // 確認ダイアログ「コマはそのまま」
  const handleConfirmWithoutClear = () => {
    updateHolidays(pendingHolidays);
    setConfirmOpen(false);
    setIsDirty(false);
    onOpenChange(false);
  };

  // 削除対象コマの日付リスト（確認ダイアログ表示用）
  const affectedDates = useMemo(() => {
    const dates = Array.from(new Set(pendingOps.map(op => op.date)));
    return dates.sort();
  }, [pendingOps]);

  // 月ごとにグループ化
  const groupedByMonth = useMemo(() => {
    const groups: Record<string, HolidayEntry[]> = {};
    localHolidays.forEach(entry => {
      const monthKey = entry.date.substring(0, 7); // YYYY-MM
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(entry);
    });
    return groups;
  }, [localHolidays]);

  const autoNotYetAdded = autoHolidays.filter(h => !localDates.has(h.date));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarX size={18} className="text-red-500" />
              {t("hol.title")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t("hol.desc")}
              {semester?.startDate && semester?.endDate && (
                <span className="ml-1 text-muted-foreground">
                  {wf(t, "hol.semPeriod", { start: semester.startDate, end: semester.endDate })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* 祝日自動取得 */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold">{t("hol.autoSection")}</p>
                  <p className="text-xs text-muted-foreground">
                    {wf(t, "hol.autoDetected", { n: autoHolidays.length })}
                    {autoNotYetAdded.length > 0 && (
                      <span className="text-amber-600 ml-1">{wf(t, "hol.notAdded", { n: autoNotYetAdded.length })}</span>
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={addAutoHolidays}
                  disabled={autoNotYetAdded.length === 0}
                >
                  <RefreshCw size={12} />
                  {t("hol.bulkAdd")}
                </Button>
              </div>
              {autoHolidays.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {autoHolidays.map(h => (
                    <Badge
                      key={h.date}
                      variant={localDates.has(h.date) ? "default" : "outline"}
                      className={cn(
                        "text-[10px] cursor-pointer transition-all",
                        localDates.has(h.date)
                          ? "bg-red-100 text-red-700 border-red-200 hover:bg-red-200"
                          : "hover:bg-muted"
                      )}
                      onClick={() => toggleAutoHoliday(h)}
                    >
                      {localDates.has(h.date) && <Check size={9} className="mr-0.5" />}
                      {h.date.substring(5)} {h.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* カスタム日付追加 */}
            <div>
              <p className="text-sm font-semibold mb-2">{t("hol.manualSection")}</p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    type="date"
                    value={customDateInput}
                    min={semester?.startDate}
                    max={semester?.endDate}
                    onChange={e => {
                      setCustomDateInput(e.target.value);
                      setCustomDateError("");
                    }}
                    onKeyDown={e => e.key === "Enter" && addCustomDate()}
                    className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {customDateError && (
                    <p className="text-xs text-red-500 mt-1">{customDateError}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={addCustomDate}>
                  <Plus size={12} />
                  {t("hol.addBtn")}
                </Button>
              </div>
            </div>

            <Separator />

            {/* 登録済みリスト */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">
                  {t("hol.registeredSection")}
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    {wf(t, "hol.countN", { n: localHolidays.length })}
                  </span>
                </p>
                {localHolidays.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-red-500 hover:text-red-600 h-6 px-2"
                    onClick={() => { setLocalHolidays([]); setIsDirty(true); }}
                  >
                    {t("hol.deleteAll")}
                  </Button>
                )}
              </div>

              {localHolidays.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  {t("hol.empty")}
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedByMonth).map(([monthKey, entries]) => {
                    const [y, m] = monthKey.split("-");
                    return (
                      <div key={monthKey}>
                        <p className="text-xs text-muted-foreground font-medium mb-1.5">
                          {wf(t, "hol.monthHeader", { y, month: monthNames[parseInt(m) - 1] })}
                        </p>
                        <div className="space-y-1">
                          {entries.map(entry => (
                            <div
                              key={entry.date}
                              className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 group"
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                <span className="text-sm">{formatDateDisplay(entry.date)}</span>
                                {entry.name && (
                                  <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground">
                                    {entry.name}
                                  </Badge>
                                )}
                              </div>
                              <button
                                onClick={() => removeHoliday(entry.date)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-border mt-2">
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
              {t("wiz.cancel")}
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleSave}
              disabled={!isDirty}
            >
              <Check size={13} />
              {t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 授業コマ削除確認ダイアログ */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CalendarX size={18} className="text-red-500" />
              {t("hol.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {t("hol.confirmPre")}<strong>{t("hol.confirmBold")}</strong>{t("hol.confirmPost")}
                </p>
                <div className="rounded-md bg-muted/50 px-3 py-2 space-y-0.5 max-h-32 overflow-y-auto">
                  {affectedDates.map(date => {
                    const count = pendingOps.filter(op => op.date === date).length;
                    const name = pendingHolidays.find(h => h.date === date)?.name;
                    return (
                      <div key={date} className="flex items-center justify-between text-xs">
                        <span>{formatDateDisplay(date)}{name ? `（${name}）` : ""}</span>
                        <span className="text-muted-foreground">{wf(t, "hol.nPeriodDelete", { n: count })}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("hol.confirmFooterNote")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
              {t("wiz.cancel")}
            </AlertDialogCancel>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleConfirmWithoutClear}
            >
              {t("hol.keepPeriods")}
            </Button>
            <AlertDialogAction
              onClick={handleConfirmWithClear}
              className="bg-red-500 hover:bg-red-600 text-white text-xs"
            >
              {t("hol.deletePeriods")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
