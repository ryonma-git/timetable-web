// ExportDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// エクスポートダイアログ: Excel / PDF（印刷ウィンドウ）/ PNG（印刷ウィンドウ）
// PDF/PNGは新しいウィンドウで印刷ダイアログを開く方式（軽量・確実）

import { useState, useMemo, useRef, useCallback } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { getClassColor } from "@/lib/gradeColors";
import {
  formatDateJP,
  getWeekDates,
  getMondayOfWeek,
  todayISO,
  formatDate,
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { X, FileImage, FileText, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportTimetableExcel } from "@/lib/exportUtils";

// ─── Types ────────────────────────────────────────────────────

type RangeMode = "single" | "month" | "semester" | "from_today_n" | "from_today_all";
type ExportFormat = "excel" | "pdf" | "png";

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

// ─── Print HTML builder ──────────────────────────────────────

interface PrintOptions {
  weeksToPrint: string[];
  effectiveEntries: ReturnType<typeof useTimetable>["effectiveEntries"];
  holidays: ReturnType<typeof useTimetable>["holidays"];
  gradeColors: ReturnType<typeof useGradeColors>["gradeColors"];
  filterClass: string;
  showReason: boolean;
  showEmptyCells: boolean;
  orientation: "landscape" | "portrait";
  title: string;
  semLabel: string;
  schoolName: string;
  includeSaturday: boolean;
  includeSunday: boolean;
  isPng: boolean;
}

function buildPrintHtml(opts: PrintOptions): string {
  const {
    weeksToPrint, effectiveEntries, holidays, gradeColors,
    filterClass, showReason, showEmptyCells, orientation,
    title, semLabel, schoolName, includeSaturday, includeSunday, isPng,
  } = opts;

  const holidayDates = new Set(holidays.map(h => h.date));
  const holidayNameMap = new Map(holidays.map(h => [h.date, h.name ?? "休校"]));
  const entryByDate = new Map(effectiveEntries.map(e => [e.date, e]));

  const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

  const weeksHtml = weeksToPrint.map((mondayStr, wIdx) => {
    const monday = isoToDate(mondayStr);
    const fri = addDays(monday, 4);
    const weekDates: string[] = [];
    // build dates for this week
    const days = includeSunday ? 7 : includeSaturday ? 6 : 5;
    for (let i = 0; i < days; i++) {
      const d = addDays(monday, i);
      const iso = formatDate(d);
      weekDates.push(iso);
    }

    const weekLabel = `${monday.getFullYear()}年 ${monday.getMonth() + 1}月${monday.getDate()}日（月）〜 ${fri.getMonth() + 1}月${fri.getDate()}日（金）`;

    const headerCols = weekDates.map(date => {
      const isHoliday = holidayDates.has(date);
      const d = isoToDate(date);
      const dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const dayLabel = DAY_LABELS[dayIdx];
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const holidayName = holidayNameMap.get(date);
      return `<th style="border:1px solid #ccc;padding:4px 2px;text-align:center;background:${isHoliday ? "#fef2f2" : "#f0f0f0"};font-size:10px;">
        <div style="font-weight:bold;">${month}/${day}（${dayLabel}）</div>
        ${isHoliday ? `<div style="font-size:7px;color:#dc2626;background:#fee2e2;border-radius:2px;padding:0 2px;margin-top:1px;">${holidayName}</div>` : ""}
      </th>`;
    }).join("");

    const bodyRows = [1, 2, 3, 4, 5, 6].map(period => {
      const cells = weekDates.map(date => {
        const entry = entryByDate.get(date);
        const slot = entry?.periods.find(p => p.period === period) ?? { period, class: null };
        const isHoliday = holidayDates.has(date);
        const isFiltered = filterClass !== "__all__" && slot.class !== filterClass;
        const displayClass = isFiltered ? null : slot.class;
        const displayReason = isFiltered ? null : (slot as unknown as Record<string, unknown>).reason as string | null;
        const colors = displayClass ? getClassColor(displayClass, gradeColors) : null;

        let cellContent = "";
        if (displayClass) {
          cellContent = `<div style="font-size:10px;font-weight:bold;color:${colors?.text ?? "#333"};line-height:1.2;">${displayClass}</div>`;
          if (showReason && displayReason) {
            cellContent += `<div style="font-size:7px;color:#666;margin-top:1px;">${displayReason}</div>`;
          }
        } else if (showEmptyCells && !isHoliday) {
          cellContent = `<div style="font-size:9px;color:#ccc;text-align:center;">—</div>`;
        }

        return `<td style="border:1px solid #ccc;padding:3px 4px;background:${isHoliday ? "#fef2f2" : (colors?.bg ?? "white")};min-height:24px;vertical-align:top;">${cellContent}</td>`;
      }).join("");

      return `<tr>
        <td style="border:1px solid #ccc;text-align:center;padding:2px;background:#f8f8f8;width:28px;">
          <div style="font-size:10px;font-weight:bold;color:#555;">${period}</div>
          <div style="font-size:7px;color:#aaa;">限</div>
        </td>
        ${cells}
      </tr>`;
    }).join("");

    const pageBreak = wIdx < weeksToPrint.length - 1 ? "page-break-after:always;" : "";

    return `<div style="${pageBreak}padding:8mm;">
      <div style="border-bottom:2px solid #333;padding-bottom:4px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:baseline;">
        <div>
          <span style="font-size:12px;font-weight:bold;">${title}${filterClass !== "__all__" ? ` — ${filterClass}` : ""}</span>
          <span style="font-size:9px;color:#666;margin-left:8px;">${semLabel ? semLabel + " / " : ""}${weekLabel}${schoolName ? " / " + schoolName : ""}</span>
        </div>
        <span style="font-size:8px;color:#bbb;">${wIdx + 1}/${weeksToPrint.length}ページ</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
        <thead>
          <tr>
            <th style="border:1px solid #ccc;padding:4px;width:28px;background:#f0f0f0;font-size:9px;color:#888;">時限</th>
            ${headerCols}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }).join("");

  const pageSize = orientation === "landscape" ? "A4 landscape" : "A4 portrait";
  const pngExtra = isPng ? `
    body { background: white; }
    @media print {
      @page { size: ${pageSize}; margin: 0; }
    }
  ` : "";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${title} 時間割</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif; background: white; }
  @media print {
    @page { size: ${pageSize}; margin: 0; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  ${pngExtra}
</style>
</head>
<body>
${weeksHtml}
${isPng ? `<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.print(); }, 300);
  });
</script>` : `<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.print(); }, 300);
  });
</script>`}
</body>
</html>`;
}

// ─── Component ───────────────────────────────────────────────

export function ExportDialog({ open, onClose }: Props) {
  const {
    effectiveEntries,
    semester,
    classList,
    currentWeekMonday,
    holidays,
    currentFile,
  } = useTimetable();
  const { gradeColors } = useGradeColors();

  const [format, setFormat] = useState<ExportFormat>("excel");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [filterClass, setFilterClass] = useState<string>("__all__");
  const [rangeMode, setRangeMode] = useState<RangeMode>("single");
  const [selectedWeekMonday, setSelectedWeekMonday] = useState<string>("");
  const [fromTodayN, setFromTodayN] = useState<number>(4);
  const [showReason, setShowReason] = useState(true);
  const [showEmptyCells, setShowEmptyCells] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);
  const today = todayISO();

  // ── Semester date range ──────────────────────────────────────
  const semesterMeta = useMemo(() => {
    if (currentFile?.semester) return currentFile.semester;
    if (semester) return semester;
    return null;
  }, [currentFile, semester]);

  // ── All weeks in semester ────────────────────────────────────
  const allWeeks = useMemo(() => {
    const weeks = new Set<string>();
    for (const entry of effectiveEntries) {
      const monday = getMondayOfWeek(isoToDate(entry.date));
      weeks.add(formatDate(monday));
    }
    return Array.from(weeks).sort();
  }, [effectiveEntries]);

  // ── Week options for select ──────────────────────────────────
  const weekOptions = useMemo(() => {
    return allWeeks.map(w => {
      const d = isoToDate(w);
      const fri = addDays(d, 4);
      return {
        value: w,
        label: `${d.getMonth() + 1}/${d.getDate()}（月）〜 ${fri.getMonth() + 1}/${fri.getDate()}（金）`,
      };
    });
  }, [allWeeks]);

  // ── Auto-select closest week ─────────────────────────────────
  useMemo(() => {
    if (selectedWeekMonday || allWeeks.length === 0) return;
    const todayMonday = formatDate(getMondayOfWeek(isoToDate(today)));
    const closest = allWeeks.find(w => w >= todayMonday) ?? allWeeks[allWeeks.length - 1];
    setSelectedWeekMonday(closest);
  }, [allWeeks, today, selectedWeekMonday]);

  // ── Compute weeks to export ──────────────────────────────────
  const weeksToPrint = useMemo(() => {
    if (allWeeks.length === 0) return [];

    switch (rangeMode) {
      case "single": {
        if (!selectedWeekMonday) return allWeeks.slice(0, 1);
        return allWeeks.includes(selectedWeekMonday) ? [selectedWeekMonday] : [allWeeks[0]];
      }
      case "month": {
        const ref = selectedWeekMonday ? isoToDate(selectedWeekMonday) : isoToDate(allWeeks[0]);
        const targetMonth = ref.getMonth();
        const targetYear = ref.getFullYear();
        return allWeeks.filter(w => {
          const d = isoToDate(w);
          return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
        });
      }
      case "semester":
        return [...allWeeks];
      case "from_today_n": {
        const todayMonday = formatDate(getMondayOfWeek(isoToDate(today)));
        const idx = allWeeks.findIndex(w => w >= todayMonday);
        const start = idx >= 0 ? idx : 0;
        return allWeeks.slice(start, start + fromTodayN);
      }
      case "from_today_all": {
        const todayMonday = formatDate(getMondayOfWeek(isoToDate(today)));
        const idx = allWeeks.findIndex(w => w >= todayMonday);
        return idx >= 0 ? allWeeks.slice(idx) : allWeeks;
      }
      default:
        return allWeeks.slice(0, 1);
    }
  }, [rangeMode, selectedWeekMonday, allWeeks, today, fromTodayN]);

  // ── Range label ──────────────────────────────────────────────
  const rangeLabel = useMemo(() => {
    if (weeksToPrint.length === 0) return "なし";
    if (weeksToPrint.length === 1) {
      const d = isoToDate(weeksToPrint[0]);
      const fri = addDays(d, 4);
      return `${d.getMonth() + 1}/${d.getDate()}〜${fri.getMonth() + 1}/${fri.getDate()}`;
    }
    const first = isoToDate(weeksToPrint[0]);
    const last = isoToDate(weeksToPrint[weeksToPrint.length - 1]);
    const lastFri = addDays(last, 4);
    return `${first.getMonth() + 1}/${first.getDate()}〜${lastFri.getMonth() + 1}/${lastFri.getDate()}（${weeksToPrint.length}週）`;
  }, [weeksToPrint]);

  // ── Holiday map ──────────────────────────────────────────────
  const holidayDates = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const holidayNameMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays]);

  // ── Entry map ────────────────────────────────────────────────
  const entryByDate = useMemo(
    () => new Map(effectiveEntries.map(e => [e.date, e])),
    [effectiveEntries]
  );

  // ── Semester label ───────────────────────────────────────────
  const semLabel = useMemo(() => {
    if (!semesterMeta) return "";
    const sem = semesterMeta;
    const termLabel = sem.semesterSystem === "semester"
      ? (sem.semesterNumber === 1 ? "前期" : "後期")
      : `${sem.semesterNumber}学期`;
    return termLabel;
  }, [semesterMeta]);

  const showSaturday = false;
  const showSunday = false;

  // ── Open print window ────────────────────────────────────────
  const openPrintWindow = useCallback((isPng: boolean) => {
    if (weeksToPrint.length === 0) return;
    const html = buildPrintHtml({
      weeksToPrint,
      effectiveEntries,
      holidays,
      gradeColors,
      filterClass,
      showReason,
      showEmptyCells,
      orientation,
      title: currentFile?.meta.title ?? "時間割",
      semLabel,
      schoolName: currentFile?.meta.school ?? "",
      includeSaturday: showSaturday,
      includeSunday: showSunday,
      isPng,
    });
    const win = window.open("", "_blank");
    if (!win) {
      alert("ポップアップがブロックされています。ブラウザの設定でポップアップを許可してください。");
      return;
    }
    win.document.write(html);
    win.document.close();
  }, [weeksToPrint, effectiveEntries, holidays, gradeColors, filterClass, showReason, showEmptyCells, orientation, currentFile, semLabel]);

  // ── Export: Excel ────────────────────────────────────────────
  const handleExportExcel = useCallback(async () => {
    if (weeksToPrint.length === 0) return;
    setIsExporting(true);
    try {
      const title = currentFile?.meta.title ?? "時間割";
      await exportTimetableExcel(
        effectiveEntries,
        weeksToPrint,
        title,
        filterClass === "__all__" ? null : filterClass,
        gradeColors,
        showReason,
      );
    } finally {
      setIsExporting(false);
    }
  }, [weeksToPrint, currentFile, effectiveEntries, filterClass, gradeColors, showReason]);

  // ── Dispatch export ──────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (format === "excel") {
      await handleExportExcel();
    } else if (format === "pdf") {
      openPrintWindow(false);
    } else if (format === "png") {
      openPrintWindow(true);
    }
  }, [format, handleExportExcel, openPrintWindow]);

  const formatButtons: { value: ExportFormat; label: string; icon: React.ReactNode; desc: string }[] = [
    { value: "excel", label: "Excel", icon: <FileSpreadsheet size={12} />, desc: ".xlsx形式でダウンロード" },
    { value: "pdf", label: "PDF", icon: <FileText size={12} />, desc: "印刷ダイアログ→「PDFとして保存」" },
    { value: "png", label: "PNG", icon: <FileImage size={12} />, desc: "印刷ダイアログ→スクリーンショット" },
  ];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base font-bold">エクスポート</DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-border bg-muted/30 shrink-0 space-y-3">
          {/* Row 1: Format + Range */}
          <div className="flex flex-wrap items-end gap-4">
            {/* Format */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">形式</Label>
              <div className="flex gap-1">
                {formatButtons.map(fb => (
                  <button
                    key={fb.value}
                    onClick={() => setFormat(fb.value)}
                    title={fb.desc}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors",
                      format === fb.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    )}
                  >
                    {fb.icon}
                    {fb.label}
                  </button>
                ))}
              </div>
              {(format === "pdf" || format === "png") && (
                <p className="text-[10px] text-amber-600 mt-1">
                  ※ 新しいウィンドウで印刷ダイアログが開きます。PDF保存・スクリーンショット撮影はブラウザの機能をご利用ください。
                </p>
              )}
            </div>

            {/* Range mode */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">範囲</Label>
              <div className="flex gap-1 flex-wrap">
                {([
                  { value: "single", label: "1週" },
                  { value: "month", label: "月単位" },
                  { value: "semester", label: "学期全体" },
                  { value: "from_today_n", label: "今週から先n週" },
                  { value: "from_today_all", label: "今週から先全て" },
                ] as const).map(m => (
                  <button
                    key={m.value}
                    onClick={() => setRangeMode(m.value)}
                    className={cn(
                      "px-2.5 py-1.5 text-xs rounded border transition-colors",
                      rangeMode === m.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Week selector (single / month) */}
            {(rangeMode === "single" || rangeMode === "month") && (
              <div className="space-y-1 min-w-[200px]">
                <Label className="text-xs text-muted-foreground">
                  {rangeMode === "month" ? "月を選択" : "週を選択"}
                </Label>
                <Select value={selectedWeekMonday} onValueChange={setSelectedWeekMonday}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="週を選択..." />
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
            )}

            {/* n weeks input */}
            {rangeMode === "from_today_n" && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">週数</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    value={fromTodayN}
                    onChange={e => setFromTodayN(Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))}
                    className="h-8 w-20 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">週</span>
                </div>
              </div>
            )}
          </div>

          {/* Row 2: Class filter, orientation, options */}
          <div className="flex flex-wrap items-end gap-4">
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
                    {o === "landscape" ? "横（A4）" : "縦（A4）"}
                  </button>
                ))}
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Switch id="exp-show-reason" checked={showReason} onCheckedChange={setShowReason} className="scale-75" />
                <Label htmlFor="exp-show-reason" className="text-xs text-muted-foreground cursor-pointer">備考表示</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch id="exp-show-empty" checked={showEmptyCells} onCheckedChange={setShowEmptyCells} className="scale-75" />
                <Label htmlFor="exp-show-empty" className="text-xs text-muted-foreground cursor-pointer">空きコマ表示</Label>
              </div>
            </div>

            {/* Range summary */}
            <div className="ml-auto text-xs text-muted-foreground">
              範囲: <span className="font-medium text-foreground">{rangeLabel}</span>
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
                  学期データを読み込むとプレビューが表示されます
                </div>
              ) : (
                weeksToPrint.map((mondayStr, wIdx) => {
                  const monday = isoToDate(mondayStr);
                  const fri = addDays(monday, 4);
                  const weekDates = getWeekDates(monday, { includeSaturday: showSaturday, includeSunday: showSunday });
                  const weekLabel = `${monday.getFullYear()}年 ${monday.getMonth() + 1}月${monday.getDate()}日（月）〜 ${fri.getMonth() + 1}月${fri.getDate()}日（金）`;

                  return (
                    <div key={mondayStr} className={cn("week-block", wIdx < weeksToPrint.length - 1 && "mb-8")}>
                      {/* Week header */}
                      <div className="week-header flex items-baseline justify-between border-b-2 border-gray-800 pb-1 mb-2">
                        <div>
                          <span className="week-title text-sm font-bold">
                            {currentFile?.meta.title ?? "時間割"}
                            {filterClass !== "__all__" && ` — ${filterClass}`}
                          </span>
                          <span className="week-subtitle text-xs text-muted-foreground ml-3">
                            {semLabel && `${semLabel} / `}{weekLabel}
                            {currentFile?.meta.school && ` / ${currentFile.meta.school}`}
                          </span>
                        </div>
                        <span className="text-[9px] text-muted-foreground/50">
                          {wIdx + 1}/{weeksToPrint.length}ページ
                        </span>
                      </div>

                      {/* Grid */}
                      <table className="w-full border-collapse text-xs" style={{ borderColor: "#ccc" }}>
                        <thead>
                          <tr>
                            <th className="period-col border border-gray-300 py-1 w-9 text-center text-[9px] text-gray-500 bg-gray-100">
                              時限
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
                                        {holidayNameMap.get(date) ?? "休校"}
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
                                    <span className="text-[7px] text-gray-400">限</span>
                                  </div>
                                </td>
                                {weekDates.map(date => {
                                  const entry = entryByDate.get(date);
                                  const slot = entry?.periods.find(p => p.period === period) ?? { period, class: null };
                                  const isHoliday = holidayDates.has(date);

                                  const isFiltered = filterClass !== "__all__" && slot.class !== filterClass;
                                  const displayClass = isFiltered ? null : slot.class;
                                  const displayReason = isFiltered ? null : (slot as unknown as Record<string, unknown>).reason as string | null;

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
            閉じる
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{weeksToPrint.length}週分</span>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={weeksToPrint.length === 0 || isExporting}
              className="gap-1.5 min-w-[140px]"
            >
              {isExporting ? (
                <><Loader2 size={13} className="animate-spin" />処理中...</>
              ) : format === "excel" ? (
                <><FileSpreadsheet size={13} />Excelでダウンロード</>
              ) : format === "pdf" ? (
                <><Printer size={13} />PDF印刷ウィンドウを開く</>
              ) : (
                <><Printer size={13} />PNG印刷ウィンドウを開く</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
