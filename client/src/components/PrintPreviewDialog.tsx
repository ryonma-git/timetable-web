// PrintPreviewDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// 印刷プレビューダイアログ
// 範囲モード: 単週 / 月単位 / 学期全体 / 今週から先n週 / 今週から先全て

import { useState, useMemo, useRef, useEffect } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { getClassColor } from "@/lib/gradeColors";
import {
  formatDate,
  formatDateJP,
  getWeekDates,
  getMondayOfWeek,
  TimetableEntry,
  todayISO,
} from "@/lib/timetable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Printer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/contexts/LanguageContext";

function wfp(t: (k: TranslationKey) => string, key: TranslationKey, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// ─── Types ────────────────────────────────────────────────────

type RangeMode = "single" | "month" | "semester" | "from_today_n" | "from_today_all";

interface WeekOption {
  value: string; // YYYY-MM-DD (monday)
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isoToDate(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

function getMonthLabelJa(monday: Date): string {
  return `${monday.getFullYear()}年${monday.getMonth() + 1}月`;
}

function getMonthLabelEn(monday: Date): string {
  return monday.toLocaleString("en-US", { month: "long", year: "numeric" });
}

// ─── Component ───────────────────────────────────────────────

export function PrintPreviewDialog({ open, onClose }: Props) {
  const {
    effectiveEntries,
    semester,
    classList,
    currentWeekMonday,
    holidays,
    currentFile,
  } = useTimetable();
  const { gradeColors } = useGradeColors();
  const { t, language } = useLanguage();

  // ── Options ─────────────────────────────────────────────────
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [filterClass, setFilterClass] = useState<string>("__all__");
  const [rangeMode, setRangeMode] = useState<RangeMode>("single");
  const [selectedWeekMonday, setSelectedWeekMonday] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [fromTodayN, setFromTodayN] = useState<number>(4);
  const [showEmptyCells, setShowEmptyCells] = useState(true);
  const [showReason, setShowReason] = useState(true);

  const printRef = useRef<HTMLDivElement>(null);

  // ── Derive semester date range ───────────────────────────────
  // Support both single-semester (currentFile.semester) and multi-semester
  const semesterMeta = useMemo(() => {
    if (semester) return semester;
    // Fallback: derive from effective entries
    if (effectiveEntries.length > 0) {
      const dates = effectiveEntries.map(e => e.date).sort();
      return { startDate: dates[0], endDate: dates[dates.length - 1] };
    }
    return null;
  }, [semester, effectiveEntries]);

  // ── All weeks in semester ────────────────────────────────────
  const allWeeks = useMemo((): WeekOption[] => {
    if (!semesterMeta?.startDate || !semesterMeta?.endDate) return [];
    const weeks: WeekOption[] = [];
    const start = getMondayOfWeek(isoToDate(semesterMeta.startDate));
    const end = isoToDate(semesterMeta.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      const mondayStr = formatDate(d);
      const fri = addDays(d, 4);
      const label = language === "ja"
        ? `${d.getFullYear()}年 ${d.getMonth() + 1}/${d.getDate()}（月）〜 ${fri.getMonth() + 1}/${fri.getDate()}（金）`
        : `${d.getMonth() + 1}/${d.getDate()} (Mon) – ${fri.getMonth() + 1}/${fri.getDate()} (Fri)`;
      weeks.push({ value: mondayStr, label });
    }
    return weeks;
  }, [semesterMeta]);

  // ── All months in semester ───────────────────────────────────
  const allMonths = useMemo(() => {
    const seen = new Set<string>();
    const months: { value: string; label: string }[] = [];
    for (const w of allWeeks) {
      const d = isoToDate(w.value);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!seen.has(key)) {
        seen.add(key);
        months.push({ value: key, label: language === "ja" ? getMonthLabelJa(d) : getMonthLabelEn(d) });
      }
    }
    return months;
  }, [allWeeks]);

  // ── Initialize defaults when dialog opens ───────────────────
  useEffect(() => {
    if (!open) return;
    const currentMonday = formatDate(currentWeekMonday);
    // Find closest week in allWeeks
    if (allWeeks.length > 0) {
      const found = allWeeks.find(w => w.value === currentMonday);
      setSelectedWeekMonday(found ? currentMonday : allWeeks[0].value);
    }
    if (allMonths.length > 0) {
      const currentKey = `${currentWeekMonday.getFullYear()}-${String(currentWeekMonday.getMonth() + 1).padStart(2, "0")}`;
      const found = allMonths.find(m => m.value === currentKey);
      setSelectedMonth(found ? currentKey : allMonths[0].value);
    }
  }, [open, allWeeks, allMonths, currentWeekMonday]);

  // ── Compute weeks to print based on range mode ───────────────
  const weeksToPrint = useMemo((): string[] => {
    if (allWeeks.length === 0) return [];

    switch (rangeMode) {
      case "single": {
        return selectedWeekMonday ? [selectedWeekMonday] : allWeeks.slice(0, 1).map(w => w.value);
      }
      case "month": {
        if (!selectedMonth) return [];
        return allWeeks
          .filter(w => {
            const d = isoToDate(w.value);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            return key === selectedMonth;
          })
          .map(w => w.value);
      }
      case "semester": {
        return allWeeks.map(w => w.value);
      }
      case "from_today_n": {
        const todayMonday = formatDate(getMondayOfWeek(new Date()));
        const idx = allWeeks.findIndex(w => w.value >= todayMonday);
        const start = idx >= 0 ? idx : 0;
        return allWeeks.slice(start, start + fromTodayN).map(w => w.value);
      }
      case "from_today_all": {
        const todayMonday = formatDate(getMondayOfWeek(new Date()));
        const idx = allWeeks.findIndex(w => w.value >= todayMonday);
        const start = idx >= 0 ? idx : 0;
        return allWeeks.slice(start).map(w => w.value);
      }
    }
  }, [rangeMode, allWeeks, selectedWeekMonday, selectedMonth, fromTodayN]);

  // ── Derived data ────────────────────────────────────────────
  const holidayDates = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const holidayNameMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name ?? "休校日"])), [holidays]);

  const entryByDate = useMemo(() => {
    const m = new Map<string, TimetableEntry>();
    effectiveEntries.forEach(e => m.set(e.date, e));
    return m;
  }, [effectiveEntries]);

  const showSaturday = semester?.hasSaturday ?? false;
  const showSunday = semester?.hasSunday ?? false;

  const today = todayISO();

  // ── Semester label ───────────────────────────────────────────
  const semLabel = useMemo(() => {
    if (!semester) return "";
    const sem = semester;
    if (sem.semesterSystem === "semester") {
      return language === "ja"
        ? (sem.semesterNumber === 1 ? "前期" : "後期")
        : (sem.semesterNumber === 1 ? "1st sem." : "2nd sem.");
    }
    return language === "ja" ? `${sem.semesterNumber}学期` : `Term ${sem.semesterNumber}`;
  }, [semester, language]);

  // ── Print handler ────────────────────────────────────────────
  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const isLandscape = orientation === "landscape";
    const printWindow = window.open("", "_blank", "width=1000,height=700");
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${currentFile?.meta.title ?? t("print.titleFallback")} ${t("print.printBtn")}</title>
<style>
@page { size: A4 ${isLandscape ? "landscape" : "portrait"}; margin: 10mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Noto Sans JP', 'BIZ UDPGothic', 'Meiryo', sans-serif; font-size: 9px; margin: 0; padding: 0; }
.week-block { page-break-after: always; margin-bottom: 0; }
.week-block:last-child { page-break-after: avoid; }
.week-header { margin-bottom: 4px; border-bottom: 2px solid #333; padding-bottom: 3px; display: flex; justify-content: space-between; align-items: baseline; }
.week-title { font-size: 12px; font-weight: bold; }
.week-subtitle { font-size: 9px; color: #666; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ccc; padding: 3px 4px; vertical-align: top; }
th { background: #f0f0f0; font-weight: bold; text-align: center; font-size: 9px; }
.period-col { width: 30px; text-align: center; background: #f8f8f8; }
.cell-class { font-size: 10px; font-weight: bold; line-height: 1.2; }
.cell-reason { font-size: 7px; color: #777; margin-top: 1px; }
.cell-empty { color: #ccc; text-align: center; font-size: 9px; }
.holiday-bg { background: #fef2f2 !important; }
.today-bg { background: #fffbeb !important; }
.holiday-badge { display: inline-block; font-size: 7px; background: #fee2e2; color: #dc2626; border-radius: 2px; padding: 0 2px; margin-top: 1px; }
</style>
</head>
<body>
${printContent.innerHTML}
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  // ── Render range label ───────────────────────────────────────
  const rangeLabel = useMemo(() => {
    if (weeksToPrint.length === 0) return t("print.noRange");
    if (weeksToPrint.length === 1) {
      const w = allWeeks.find(x => x.value === weeksToPrint[0]);
      return w?.label ?? weeksToPrint[0];
    }
    const first = isoToDate(weeksToPrint[0]);
    const lastMonday = isoToDate(weeksToPrint[weeksToPrint.length - 1]);
    const lastFri = addDays(lastMonday, 4);
    if (language === "ja") {
      return `${first.getFullYear()}年 ${first.getMonth() + 1}/${first.getDate()} 〜 ${lastFri.getMonth() + 1}/${lastFri.getDate()}（${weeksToPrint.length}週）`;
    }
    return `${first.getMonth() + 1}/${first.getDate()} – ${lastFri.getMonth() + 1}/${lastFri.getDate()} (${weeksToPrint.length} wk)`;
  }, [weeksToPrint, allWeeks]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Printer size={17} />
            {t("print.dialogTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-border bg-muted/30 shrink-0 space-y-3">
          {/* Row 1: Range mode */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("print.rangeLabel")}</Label>
              <div className="flex flex-wrap gap-1">
                {([
                  { id: "single", label: t("print.rangeSingle") },
                  { id: "month", label: t("print.rangeMonth") },
                  { id: "semester", label: t("print.rangeSemester") },
                  { id: "from_today_n", label: t("print.rangeFromN") },
                  { id: "from_today_all", label: t("print.rangeFromAll") },
                ] as { id: RangeMode; label: string }[]).map(m => (
                  <button
                    key={m.id}
                    onClick={() => setRangeMode(m.id)}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded border transition-colors",
                      rangeMode === m.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Range-specific controls */}
            {rangeMode === "single" && (
              <div className="space-y-1 min-w-[280px]">
                <Label className="text-xs text-muted-foreground">{t("print.weekLabel")}</Label>
                {allWeeks.length > 0 ? (
                  <Select value={selectedWeekMonday} onValueChange={setSelectedWeekMonday}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={t("print.weekPh")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 overflow-y-auto">
                      {allWeeks.map(w => (
                        <SelectItem key={w.value} value={w.value} className="text-xs">
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("print.noData")}</p>
                )}
              </div>
            )}

            {rangeMode === "month" && (
              <div className="space-y-1 min-w-[180px]">
                <Label className="text-xs text-muted-foreground">{t("print.monthLabel")}</Label>
                {allMonths.length > 0 ? (
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={t("print.monthPh")} />
                    </SelectTrigger>
                    <SelectContent>
                      {allMonths.map(m => (
                        <SelectItem key={m.value} value={m.value} className="text-xs">
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("print.noData")}</p>
                )}
              </div>
            )}

            {rangeMode === "from_today_n" && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("print.nWeeksLabel")}</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    value={fromTodayN}
                    onChange={e => setFromTodayN(Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))}
                    className="h-8 w-20 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">{t("print.weeksSuffix")}</span>
                </div>
              </div>
            )}
          </div>

          {/* Row 2: Class filter, orientation, options */}
          <div className="flex flex-wrap items-end gap-4">
            {/* Class filter */}
            <div className="space-y-1 min-w-[160px]">
              <Label className="text-xs text-muted-foreground">{t("print.classFilter")}</Label>
              <Select value={filterClass} onValueChange={setFilterClass}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64 overflow-y-auto">
                  <SelectItem value="__all__" className="text-xs">{t("print.classAll")}</SelectItem>
                  {classList.map(c => (
                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Orientation */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("print.orientation")}</Label>
              <div className="flex gap-1">
                {(["landscape", "portrait"] as const).map(o => (
                  <button
                    key={o}
                    onClick={() => setOrientation(o)}
                    className={cn(
                      "px-3 py-1.5 text-xs rounded border transition-colors",
                      orientation === o
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    )}
                  >
                    {o === "landscape" ? t("print.landscape") : t("print.portrait")}
                  </button>
                ))}
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Switch id="show-empty" checked={showEmptyCells} onCheckedChange={setShowEmptyCells} className="scale-75" />
                <Label htmlFor="show-empty" className="text-xs text-muted-foreground cursor-pointer">{t("print.showEmpty")}</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch id="show-reason" checked={showReason} onCheckedChange={setShowReason} className="scale-75" />
                <Label htmlFor="show-reason" className="text-xs text-muted-foreground cursor-pointer">{t("print.showReason")}</Label>
              </div>
            </div>

            {/* Range summary */}
            <div className="ml-auto text-xs text-muted-foreground">
              {t("print.rangeDisplay")} <span className="font-medium text-foreground">{rangeLabel}</span>
            </div>
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-auto p-5 bg-gray-100">
          <div
            className={cn(
              "bg-white shadow-md mx-auto",
              orientation === "landscape" ? "w-[270mm]" : "w-[190mm]"
            )}
            style={{ padding: "10mm", minHeight: orientation === "landscape" ? "190mm" : "270mm" }}
          >
            <div ref={printRef}>
              {weeksToPrint.length === 0 ? (
                <div className="text-center py-16 text-sm text-muted-foreground">
                  {t("print.noPreview")}
                </div>
              ) : (
                weeksToPrint.map((mondayStr, wIdx) => {
                  const monday = isoToDate(mondayStr);
                  const fri = addDays(monday, 4);
                  const weekDates = getWeekDates(monday, { includeSaturday: showSaturday, includeSunday: showSunday });
                  const weekLabel = language === "ja"
                    ? `${monday.getFullYear()}年 ${monday.getMonth() + 1}月${monday.getDate()}日（月）〜 ${fri.getMonth() + 1}月${fri.getDate()}日（金）`
                    : `${monday.getMonth() + 1}/${monday.getDate()} (Mon) – ${fri.getMonth() + 1}/${fri.getDate()} (Fri) ${monday.getFullYear()}`;

                  return (
                    <div key={mondayStr} className={cn("week-block", wIdx < weeksToPrint.length - 1 && "mb-8")}>
                      {/* Week header */}
                      <div className="week-header flex items-baseline justify-between border-b-2 border-gray-800 pb-1 mb-2">
                        <div>
                          <span className="week-title text-sm font-bold">
                            {currentFile?.meta.title ?? t("print.titleFallback")}
                            {filterClass !== "__all__" && ` — ${filterClass}`}
                          </span>
                          <span className="week-subtitle text-xs text-muted-foreground ml-3">
                            {semLabel && `${semLabel} / `}{weekLabel}
                            {currentFile?.meta.school && ` / ${currentFile.meta.school}`}
                          </span>
                        </div>
                        <span className="text-[9px] text-muted-foreground/50">
                          {wfp(t, "print.pageCount", { n: `${wIdx + 1}/${weeksToPrint.length}` })}
                        </span>
                      </div>

                      {/* Grid */}
                      <table className="w-full border-collapse text-xs" style={{ borderColor: "#ccc" }}>
                        <thead>
                          <tr>
                            <th className="period-col border border-gray-300 py-1 w-9 text-center text-[9px] text-gray-500 bg-gray-100">
                              {t("print.periodHeader")}
                            </th>
                            {weekDates.map(date => {
                              const isHoliday = holidayDates.has(date);
                              return (
                                <th
                                  key={date}
                                  className="border border-gray-300 py-1 px-1 text-center"
                                  style={{
                                    backgroundColor: isHoliday ? "#fef2f2" : "#f0f0f0",
                                  }}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[10px] font-bold">{formatDateJP(date)}</span>
                                    {isHoliday && (
                                      <span className="holiday-badge text-[7px] bg-red-100 text-red-600 rounded px-1">
                                        {holidayNameMap.get(date) ?? t("print.holidayDefault")}
                                      </span>
                                    )}
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {[1, 2, 3, 4, 5, 6].map(period => {
                            return (
                              <tr key={period}>
                                <td className="period-col border border-gray-300 text-center py-1 bg-gray-50">
                                  <div className="flex flex-col items-center">
                                    <span className="font-bold text-[10px] text-gray-700">{period}</span>
                                    {t("print.periodSuffix") && <span className="text-[7px] text-gray-400">{t("print.periodSuffix")}</span>}
                                  </div>
                                </td>
                                {weekDates.map(date => {
                                  const entry = entryByDate.get(date);
                                  const slot = entry?.periods.find(p => p.period === period) ?? { period, class: null };
                                  const isHoliday = holidayDates.has(date);

                                  const isFiltered = filterClass !== "__all__" && slot.class !== filterClass;
                                  const displayClass = isFiltered ? null : slot.class;
                                  const displayReason = isFiltered ? null : slot.reason;

                                  const colors = displayClass ? getClassColor(displayClass, gradeColors) : null;

                                  return (
                                    <td
                                      key={date}
                                      className="border border-gray-300 p-1"
                                      style={{
                                        backgroundColor: isHoliday
                                          ? "#fef2f2"
                                          : colors?.bg ?? undefined,
                                        minHeight: "24px",
                                      }}
                                    >
                                      {displayClass ? (
                                        <div>
                                          <div
                                            className="cell-class text-[10px] font-bold leading-tight"
                                            style={{ color: colors?.text ?? "#333" }}
                                          >
                                            {displayClass}
                                          </div>
                                          {showReason && displayReason && (
                                            <div className="cell-reason text-[8px] text-gray-500 mt-0.5">
                                              {displayReason}
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        showEmptyCells && !isHoliday ? (
                                          <div className="cell-empty text-[9px] text-gray-300 text-center">—</div>
                                        ) : null
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-background shrink-0 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={onClose} className="gap-1.5">
            <X size={13} />
            {t("print.closeBtn")}
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{wfp(t, "print.pageCount", { n: weeksToPrint.length })}</span>
            <Button size="sm" onClick={handlePrint} disabled={weeksToPrint.length === 0} className="gap-1.5">
              <Printer size={13} />
              {t("print.printBtn")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
