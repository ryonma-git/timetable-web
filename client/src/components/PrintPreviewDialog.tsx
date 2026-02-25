// PrintPreviewDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// 印刷プレビューダイアログ: 週選択・クラスフィルター・A4縦横切り替え対応

import { useState, useMemo, useRef } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { getClassColor } from "@/lib/gradeColors";
import {
  formatDate,
  formatDateJP,
  getWeekDates,
  getMondayOfWeek,
  TimetableEntry,
  PeriodSlot,
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
import { Printer, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const PERIOD_LABELS = ["", "1限", "2限", "3限", "4限", "5限", "6限"];

interface Props {
  open: boolean;
  onClose: () => void;
}

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

  // ── Options ─────────────────────────────────────────────────
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [filterClass, setFilterClass] = useState<string>("__all__");
  const [selectedWeekMonday, setSelectedWeekMonday] = useState<string>(() => formatDate(currentWeekMonday));
  const [showEmptyCells, setShowEmptyCells] = useState(true);
  const [showReason, setShowReason] = useState(true);

  const printRef = useRef<HTMLDivElement>(null);

  // ── Week list (all weeks in semester) ───────────────────────
  const weekOptions = useMemo(() => {
    if (!semester?.startDate || !semester?.endDate) return [];
    const weeks: { value: string; label: string }[] = [];
    const start = getMondayOfWeek(new Date(semester.startDate + "T00:00:00"));
    const end = new Date(semester.endDate + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      const mondayStr = formatDate(d);
      const fri = new Date(d);
      fri.setDate(fri.getDate() + 4);
      const label = `${d.getMonth() + 1}/${d.getDate()}（月）〜 ${fri.getMonth() + 1}/${fri.getDate()}（金）`;
      weeks.push({ value: mondayStr, label });
    }
    return weeks;
  }, [semester]);

  // ── Derived data ────────────────────────────────────────────
  const holidayDates = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const holidayNameMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name ?? '休校日'])), [holidays]);

  const weekMonday = useMemo(() => {
    const d = new Date(selectedWeekMonday + "T00:00:00");
    return d;
  }, [selectedWeekMonday]);

  const showSaturday = semester?.hasSaturday ?? false;
  const showSunday = semester?.hasSunday ?? false;
  const weekDates = useMemo(() =>
    getWeekDates(weekMonday, { includeSaturday: showSaturday, includeSunday: showSunday }),
    [weekMonday, showSaturday, showSunday]
  );

  const entryByDate = useMemo(() => {
    const m = new Map<string, TimetableEntry>();
    effectiveEntries.forEach(e => m.set(e.date, e));
    return m;
  }, [effectiveEntries]);

  const getSlot = (date: string, period: number): PeriodSlot => {
    const entry = entryByDate.get(date);
    if (!entry) return { period, class: null };
    return entry.periods.find(p => p.period === period) ?? { period, class: null };
  };

  // ── Academic year / semester label ──────────────────────────
  const headerLabel = useMemo(() => {
    if (!semester) return "";
    const year = weekMonday.getFullYear();
    const month = weekMonday.getMonth() + 1;
    const academicYear = month >= 4 ? year : year - 1;
    const semLabel = semester.semesterSystem === "semester"
      ? (semester.semesterNumber === 1 ? "前期" : "後期")
      : `${semester.semesterNumber}学期`;
    return `${academicYear}年度 ${semLabel}`;
  }, [semester, weekMonday]);

  const weekLabel = useMemo(() => {
    const fri = new Date(weekMonday);
    fri.setDate(fri.getDate() + 4);
    return `${weekMonday.getFullYear()}年 ${weekMonday.getMonth() + 1}月${weekMonday.getDate()}日（月）〜 ${fri.getMonth() + 1}月${fri.getDate()}日（金）`;
  }, [weekMonday]);

  const today = todayISO();

  // ── Print handler ────────────────────────────────────────────
  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    const styles = Array.from(document.styleSheets)
      .map(ss => {
        try {
          return Array.from(ss.cssRules).map(r => r.cssText).join("\n");
        } catch {
          return "";
        }
      })
      .join("\n");

    const isLandscape = orientation === "landscape";
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${currentFile?.meta.title ?? "時間割"} 印刷</title>
        <style>
          @page { size: A4 ${isLandscape ? "landscape" : "portrait"}; margin: 12mm; }
          * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body { font-family: 'Noto Sans JP', 'BIZ UDPGothic', sans-serif; font-size: 10px; margin: 0; padding: 0; }
          ${styles}
          .print-container { width: 100%; }
          .print-header { margin-bottom: 6px; }
          .print-title { font-size: 14px; font-weight: bold; }
          .print-subtitle { font-size: 10px; color: #666; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 3px 4px; vertical-align: top; }
          th { background: #f5f5f5; font-weight: bold; text-align: center; font-size: 9px; }
          .period-col { width: 36px; text-align: center; font-size: 9px; color: #666; }
          .cell-class { font-size: 10px; font-weight: bold; }
          .cell-reason { font-size: 8px; color: #666; margin-top: 1px; }
          .cell-empty { color: #bbb; font-size: 9px; text-align: center; }
          .holiday-col { background: #f9f9f9; opacity: 0.7; }
          .holiday-badge { font-size: 7px; background: #fee2e2; color: #dc2626; border-radius: 2px; padding: 0 3px; }
          .today-col { background: #fffbeb; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 400);
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Printer size={17} />
            印刷プレビュー
          </DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-border bg-muted/30 shrink-0">
          <div className="flex flex-wrap items-end gap-4">
            {/* Week selector */}
            <div className="space-y-1 min-w-[260px]">
              <Label className="text-xs text-muted-foreground">週の選択</Label>
              <Select value={selectedWeekMonday} onValueChange={setSelectedWeekMonday}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64 overflow-y-auto">
                  {weekOptions.map(w => (
                    <SelectItem key={w.value} value={w.value} className="text-xs">
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Class filter */}
            <div className="space-y-1 min-w-[160px]">
              <Label className="text-xs text-muted-foreground">クラスで絞り込み</Label>
              <Select value={filterClass} onValueChange={setFilterClass}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64 overflow-y-auto">
                  <SelectItem value="__all__" className="text-xs">すべて表示</SelectItem>
                  {classList.map(c => (
                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Orientation */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">用紙向き</Label>
              <div className="flex gap-1">
                <button
                  onClick={() => setOrientation("landscape")}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded border transition-colors",
                    orientation === "landscape"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  )}
                >
                  横（A4）
                </button>
                <button
                  onClick={() => setOrientation("portrait")}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded border transition-colors",
                    orientation === "portrait"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  )}
                >
                  縦（A4）
                </button>
              </div>
            </div>

            {/* Show options */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Switch
                  id="show-empty"
                  checked={showEmptyCells}
                  onCheckedChange={setShowEmptyCells}
                  className="scale-75"
                />
                <Label htmlFor="show-empty" className="text-xs text-muted-foreground cursor-pointer">空きコマ表示</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  id="show-reason"
                  checked={showReason}
                  onCheckedChange={setShowReason}
                  className="scale-75"
                />
                <Label htmlFor="show-reason" className="text-xs text-muted-foreground cursor-pointer">備考表示</Label>
              </div>
            </div>

            {/* Reset week to current */}
            <button
              onClick={() => setSelectedWeekMonday(formatDate(currentWeekMonday))}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw size={11} />
              今週に戻す
            </button>
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-auto p-5 bg-gray-100">
          <div
            className={cn(
              "bg-white shadow-md mx-auto",
              orientation === "landscape"
                ? "w-[270mm] min-h-[190mm]"
                : "w-[190mm] min-h-[270mm]"
            )}
            style={{ padding: "12mm" }}
          >
            <div ref={printRef} className="print-container">
              {/* Header */}
              <div className="print-header mb-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="print-title text-base font-bold text-foreground">
                      {currentFile?.meta.title ?? "時間割"}
                      {filterClass !== "__all__" && ` — ${filterClass}`}
                    </div>
                    <div className="print-subtitle text-xs text-muted-foreground mt-0.5">
                      {headerLabel} / {weekLabel}
                      {currentFile?.meta.school && ` / ${currentFile.meta.school}`}
                    </div>
                  </div>
                  <div className="text-[9px] text-muted-foreground/60">
                    印刷日: {new Date().toLocaleDateString("ja-JP")}
                  </div>
                </div>
              </div>

              {/* Timetable grid */}
              <table className="w-full border-collapse text-xs" style={{ borderColor: "#ccc" }}>
                <thead>
                  <tr>
                    <th className="period-col border border-gray-300 bg-gray-100 py-1.5 w-10 text-center text-[9px] text-gray-500">
                      時限
                    </th>
                    {weekDates.map(date => {
                      const isToday = date === today;
                      const isHoliday = holidayDates.has(date);
                      return (
                        <th
                          key={date}
                          className={cn(
                            "border border-gray-300 py-1.5 px-1 text-center",
                            isToday && "today-col",
                            isHoliday && "holiday-col"
                          )}
                          style={isToday ? { backgroundColor: "#fffbeb" } : isHoliday ? { backgroundColor: "#f9f9f9" } : { backgroundColor: "#f5f5f5" }}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[10px] font-bold">{formatDateJP(date)}</span>
                            {isHoliday && (
                              <span className="holiday-badge text-[7px] bg-red-100 text-red-600 rounded px-1">
                                {holidayNameMap.get(date) ?? '休校'}
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
                    // Check if any cell in this row has content (for filter mode)
                    const hasContent = weekDates.some(date => {
                      const slot = getSlot(date, period);
                      if (filterClass !== "__all__") return slot.class === filterClass;
                      return slot.class !== null;
                    });

                    // In filter mode, hide rows with no matching content
                    if (filterClass !== "__all__" && !hasContent && !showEmptyCells) return null;

                    return (
                      <tr key={period}>
                        <td className="period-col border border-gray-300 text-center py-1.5 bg-gray-50">
                          <div className="flex flex-col items-center">
                            <span className="font-bold text-[10px] text-gray-700">{period}</span>
                            <span className="text-[7px] text-gray-400">限</span>
                          </div>
                        </td>
                        {weekDates.map(date => {
                          const slot = getSlot(date, period);
                          const isHoliday = holidayDates.has(date);
                          const isToday = date === today;

                          // Filter: show only matching class
                          const isFiltered = filterClass !== "__all__" && slot.class !== filterClass;
                          const displayClass = isFiltered ? null : slot.class;
                          const displayReason = isFiltered ? null : slot.reason;

                          const colors = displayClass ? getClassColor(displayClass, gradeColors) : null;

                          return (
                            <td
                              key={date}
                              className={cn(
                                "border border-gray-300 p-1",
                                isHoliday && "holiday-col",
                                isToday && !isHoliday && "today-col"
                              )}
                              style={{
                                backgroundColor: isHoliday
                                  ? "#f9f9f9"
                                  : isToday
                                    ? "#fffbeb"
                                    : colors
                                      ? colors.bg
                                      : undefined,
                                minHeight: "28px",
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

              {/* Footer */}
              <div className="mt-3 flex items-center justify-between text-[8px] text-gray-400">
                <div className="flex items-center gap-3">
                  {/* Legend */}
                  {filterClass === "__all__" && (
                    <div className="flex items-center gap-2">
                      <span>凡例:</span>
                      {Array.from(new Set(
                        weekDates.flatMap(date =>
                          (entryByDate.get(date)?.periods ?? [])
                            .filter(p => p.class)
                            .map(p => p.class!.match(/^(\d)年/)?.[1])
                            .filter(Boolean) as string[]
                        )
                      )).sort().map(grade => {
                        const c = gradeColors[grade];
                        if (!c) return null;
                        return (
                          <div key={grade} className="flex items-center gap-1">
                            <div className="w-2.5 h-2.5 rounded border" style={{ backgroundColor: c.bg, borderColor: c.border }} />
                            <span style={{ color: c.text }}>{grade}年</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <span>{currentFile?.meta.school ?? ""}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="px-5 py-3 border-t border-border bg-background shrink-0 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={onClose} className="gap-1.5">
            <X size={13} />
            閉じる
          </Button>
          <Button size="sm" onClick={handlePrint} className="gap-1.5">
            <Printer size={13} />
            印刷する
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
