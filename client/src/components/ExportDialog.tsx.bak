// ExportDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// エクスポートダイアログ: Excel / PDF（印刷ウィンドウ）/ PNG（印刷ウィンドウ）
// PDF/PNGは新しいウィンドウで印刷ダイアログを開く方式（軽量・確実）

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
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
import { X, FileText, FileSpreadsheet, Loader2, CalendarDays, CheckCircle2, AlertCircle, ExternalLink, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportTimetableExcel } from "@/lib/exportUtils";
import { exportTimetablePdf } from "@/lib/timetablePdfExport";
import { exportToICS, downloadICS } from "@/lib/icsExport";
import { useGoogleDrive } from "@/contexts/GoogleDriveContext";
import { insertCalendarEvents, listCalendars, isTokenValid, deleteCalendarEvents, deleteCalendarEventsInRange, type CalendarEvent } from "@/lib/googleDrive";

// ─── Types ────────────────────────────────────────────────────

type RangeMode = "single" | "month" | "semester" | "from_today_n" | "from_today_all";
type ExportFormat = "excel" | "pdf" | "png" | "ics" | "raw";

type GCalSummaryFormat = "subject_class" | "class_subject" | "subject_only" | "class_only";

interface GCalProgress {
  done: number;
  total: number;
  inserted: number;
  updated: number;
  errors: number;
  status: "idle" | "running" | "done" | "error";
}

interface GCalDeleteProgress {
  done: number;
  total: number;
  deleted: number;
  errors: number;
  status: "idle" | "running" | "done" | "error";
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: ExportFormat;
  exportCSV?: () => void;
  exportEffective?: () => void;
  exportOverride?: () => void;
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

export function ExportDialog({ open, onClose, initialTab, exportCSV, exportEffective, exportOverride }: Props) {
  const {
    effectiveEntries,
    semester,
    classList,
    currentWeekMonday,
    holidays,
    currentFile,
  } = useTimetable();
  const { gradeColors } = useGradeColors();
  const { isLoggedIn, login } = useGoogleDrive();

  const [format, setFormat] = useState<ExportFormat>(initialTab ?? "excel");
  // openが変わったとき（ダイアログが開くとき）にinitialTabを反映
  useEffect(() => {
    if (open && initialTab) setFormat(initialTab);
  }, [open, initialTab]);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [filterClass, setFilterClass] = useState<string>("__all__");
  const [rangeMode, setRangeMode] = useState<RangeMode>("single");
  const [selectedWeekMonday, setSelectedWeekMonday] = useState<string>("");
  const [fromTodayN, setFromTodayN] = useState<number>(4);
  const [showReason, setShowReason] = useState(true);
  const [showEmptyCells, setShowEmptyCells] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [gcalProgress, setGcalProgress] = useState<GCalProgress>({
    done: 0, total: 0, inserted: 0, updated: 0, errors: 0, status: "idle",
  });
  const [gcalSummaryFormat, setGcalSummaryFormat] = useState<GCalSummaryFormat>("class_subject");
  const [gcalCalendars, setGcalCalendars] = useState<{ id: string; summary: string; primary?: boolean; backgroundColor?: string }[]>([]);
  const [gcalCalendarId, setGcalCalendarId] = useState("primary");
  const [gcalCalendarLoaded, setGcalCalendarLoaded] = useState(false);
  const [gcalDeleteProgress, setGcalDeleteProgress] = useState<GCalDeleteProgress>({
    done: 0, total: 0, deleted: 0, errors: 0, status: "idle",
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"tagged" | "range">("tagged");
  const [deleteRangeStart, setDeleteRangeStart] = useState("");
  const [deleteRangeEnd, setDeleteRangeEnd] = useState("");

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

  // ── Export: PDF (jsPDF直接描画) ──────────────────────────────
  const handleExportPdf = useCallback(async () => {
    if (weeksToPrint.length === 0) return;
    setIsExporting(true);
    try {
      await exportTimetablePdf({
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
        filename: currentFile?.meta.title ?? "時間割",
        outputType: "pdf",
      });
    } finally {
      setIsExporting(false);
    }
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
  // ── Export: Google Calendar ───────────────────────────────
  const handleLoadCalendars = useCallback(async () => {
    if (gcalCalendarLoaded) return;
    if (!isTokenValid()) { login(); return; }
    try {
      const cals = await listCalendars();
      setGcalCalendars(cals);
      setGcalCalendarLoaded(true);
    } catch { /* ignore */ }
  }, [gcalCalendarLoaded, login]);

  // format=ics かつ ログイン済みになったタイミングで自動取得
  useEffect(() => {
    if (format === "ics" && isLoggedIn && !gcalCalendarLoaded) {
      handleLoadCalendars();
    }
  }, [format, isLoggedIn, gcalCalendarLoaded, handleLoadCalendars]);

  const handleExportGCal = useCallback(async () => {
    if (!semester) return;
    if (!isTokenValid()) { login(); return; }

    const targetDates = new Set(weeksToPrint.flatMap(w => {
      const mondayDate = typeof w === 'string' ? new Date(w + 'T00:00:00') : w;
      return getWeekDates(mondayDate, { includeSaturday: semester.hasSaturday, includeSunday: semester.hasSunday });
    }));
    const filteredEntries = effectiveEntries.filter(e => targetDates.has(e.date));

    const DAY_NUM_TO_KEY: Record<number, string> = {
      0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat",
    };
    const getPeriodTime = (dateStr: string, periodNum: number) => {
      const dayOfWeek = new Date(dateStr + "T00:00:00").getDay();
      const dayKey = DAY_NUM_TO_KEY[dayOfWeek];
      if (semester.periodTimesByDay?.[dayKey]?.[periodNum]) return semester.periodTimesByDay[dayKey][periodNum];
      if (semester.periodTimes?.[periodNum]) return semester.periodTimes[periodNum];
      return null;
    };
    const toRFC3339 = (dateStr: string, timeStr: string) => {
      const [h, mi] = timeStr.split(":").map(Number);
      return `${dateStr}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00+09:00`;
    };
    const school = currentFile?.meta?.school;
    const events: CalendarEvent[] = [];
    for (const entry of filteredEntries) {
      for (const period of entry.periods) {
        if (!period.class && !period.subject) continue;
        const className = period.class ?? "";
        const subjectName = period.subject ?? "";
        let summary: string;
        switch (gcalSummaryFormat) {
          case "class_subject": summary = className && subjectName ? `${className} ${subjectName}` : className || subjectName; break;
          case "subject_class": summary = subjectName && className ? `${subjectName} ${className}` : subjectName || className; break;
          case "subject_only": summary = subjectName || className; break;
          case "class_only": summary = className || subjectName; break;
          default: summary = className || subjectName;
        }
        const descParts: string[] = [];
        if (school) descParts.push(`学校: ${school}`);
        descParts.push(`${period.period}限`);
        if (subjectName) descParts.push(`教科: ${subjectName}`);
        if (className) descParts.push(`クラス: ${className}`);
        if (period.reason) descParts.push(`備考: ${period.reason}`);
        // 重複防止UID: 日付+時限+クラスの組み合わせ
        const uid = `timetable-${entry.date}-p${period.period}-${(className || subjectName).replace(/[^a-zA-Z0-9぀-鿿]/g, "")}`;
        const timeSlot = getPeriodTime(entry.date, period.period);
        if (timeSlot) {
          events.push({ summary, description: descParts.join("\n"), uid,
            start: { dateTime: toRFC3339(entry.date, timeSlot.start), timeZone: "Asia/Tokyo" },
            end: { dateTime: toRFC3339(entry.date, timeSlot.end), timeZone: "Asia/Tokyo" },
          });
        } else {
          const d = new Date(entry.date + "T00:00:00");
          d.setDate(d.getDate() + 1);
          const nextDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          events.push({ summary, description: descParts.join("\n"), uid,
            start: { date: entry.date }, end: { date: nextDay },
          });
        }
      }
    }
    if (events.length === 0) return;
    setGcalProgress({ done: 0, total: events.length, inserted: 0, updated: 0, errors: 0, status: "running" });
    try {
      const result = await insertCalendarEvents(events, gcalCalendarId, (done, total) => {
        setGcalProgress(prev => ({ ...prev, done, total }));
      });
      setGcalProgress(prev => ({ ...prev, inserted: result.inserted, updated: result.updated, errors: result.errors, status: "done" }));
    } catch {
      setGcalProgress(prev => ({ ...prev, status: "error" }));
    }
  }, [weeksToPrint, semester, effectiveEntries, currentFile, gcalCalendarId, gcalSummaryFormat, login]);

  // ── Export: ICS ───────────────────────────────────────────
  const handleExportICS = useCallback(async () => {
    if (!semester) return;
    setIsExporting(true);
    try {
      // 選択された週のエントリをフィルタリング
      const targetDates = new Set(weeksToPrint.flatMap(w => {
        const mondayDate = typeof w === 'string' ? new Date(w + 'T00:00:00') : w;
        return getWeekDates(mondayDate, { includeSaturday: semester.hasSaturday, includeSunday: semester.hasSunday });
      }));
      const filteredEntries = effectiveEntries.filter(e => targetDates.has(e.date));
      const icsContent = exportToICS({
        entries: filteredEntries,
        semester,
        title: currentFile?.meta?.title ?? "時間割",
        school: currentFile?.meta?.school,
        fallbackToAllDay: true,
      });
      const filename = `${currentFile?.meta?.title ?? "時間割"}.ics`;
      downloadICS(icsContent, filename);
    } finally {
      setIsExporting(false);
    }
  }, [weeksToPrint, semester, effectiveEntries, currentFile]);

    // ── Delete from Google Calendar ─────────────────────────
  const handleDeleteGCal = useCallback(async () => {
    if (!isTokenValid()) { login(); return; }
    setShowDeleteConfirm(false);
    setGcalDeleteProgress({ done: 0, total: 0, deleted: 0, errors: 0, status: "running" });
    try {
      let result;
      if (deleteMode === "range") {
        // 期間指定削除（タグなし旧イベントも含む）
        const tMin = new Date(deleteRangeStart + "T00:00:00").toISOString();
        const tMax = new Date(deleteRangeEnd + "T23:59:59").toISOString();
        result = await deleteCalendarEventsInRange(
          gcalCalendarId,
          tMin,
          tMax,
          (done, total) => setGcalDeleteProgress(prev => ({ ...prev, done, total }))
        );
      } else {
        // タグ付きイベントのみ削除
        result = await deleteCalendarEvents(
          gcalCalendarId,
          undefined,
          undefined,
          (done, total) => setGcalDeleteProgress(prev => ({ ...prev, done, total }))
        );
      }
      setGcalDeleteProgress(prev => ({ ...prev, deleted: result.deleted, errors: result.errors, status: "done" }));
    } catch {
      setGcalDeleteProgress(prev => ({ ...prev, status: "error" }));
    }
  }, [gcalCalendarId, deleteMode, deleteRangeStart, deleteRangeEnd, login]);

  // ── Dispatch export ─────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (format === "excel") await handleExportExcel();
    else if (format === "pdf") await handleExportPdf();
    else if (format === "ics") await handleExportICS();
    // raw タブは個別ボタンで操作するためここでは何もしない
  }, [format, handleExportExcel, handleExportPdf, handleExportICS]);

  const formatButtons: { value: ExportFormat; label: string; icon: React.ReactNode; desc: string }[] = [
    { value: "excel", label: "Excel", icon: <FileSpreadsheet size={12} />, desc: ".xlsx形式でダウンロード" },
    { value: "pdf", label: "PDF", icon: <FileText size={12} />, desc: ".pdf形式でダウンロード（日本語フォント埋め込み）" },
    { value: "ics", label: "ICS / Google連携", icon: <CalendarDays size={12} />, desc: ".icsダウンロード または Googleカレンダーに直接追加" },
    { value: "raw", label: "生データ", icon: <Database size={12} />, desc: "CSV / JSON形式で書き出し" },
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
              {format === "pdf" && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  ※ 初回のみフォント読み込みのため数秒かかる場合があります。
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

        {/* ICS タブ選択時: Googleカレンダー追加エリア */}
        {format === "ics" && (
          <div className="px-5 py-3 border-t border-border bg-muted/20 overflow-y-auto max-h-[40vh] space-y-2">
            <div className="flex items-center gap-2">
              <CalendarDays size={13} className="text-blue-400" />
              <span className="text-xs font-medium">Googleカレンダーに直接追加</span>
            </div>
            {!isLoggedIn ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">ログインするとGoogleカレンダーに直接追加できます</p>
                <Button size="sm" variant="outline" onClick={login} className="h-7 text-xs gap-1">
                  Googleでログイン
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {/* イベント名形式 + カレンダー選択 + 追加ボタン */}

                <div className="flex flex-wrap items-center gap-2">
                  {/* イベント名形式 */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-muted-foreground">表示形式:</span>
                    <select
                      value={gcalSummaryFormat}
                      onChange={e => setGcalSummaryFormat(e.target.value as GCalSummaryFormat)}
                      className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground"
                    >
                      <option value="class_subject">クラス 教科（例: 5年3組 英語）</option>
                      <option value="subject_class">教科 クラス（例: 英語 5年3組）</option>
                      <option value="subject_only">教科のみ（例: 英語）</option>
                      <option value="class_only">クラスのみ（例: 5年3組）</option>
                    </select>
                  </div>
                  {/* カレンダー選択 */}
                  <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
                    <span className="text-xs text-muted-foreground shrink-0">追加先:</span>
                    <select
                      value={gcalCalendarId}
                      onChange={e => setGcalCalendarId(e.target.value)}
                      onFocus={handleLoadCalendars}
                      className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground flex-1 max-w-[240px]"
                    >
                      <option value="primary">メインカレンダー</option>
                      {gcalCalendars.filter(c => c.id !== "primary").map(c => (
                        <option key={c.id} value={c.id}>{c.summary}</option>
                      ))}
                    </select>
                    {/* カレンダー色ドット */}
                    {(() => {
                      const cal = gcalCalendars.find(c => c.id === gcalCalendarId);
                      const color = cal?.backgroundColor ?? (gcalCalendarId === "primary" ? "#4285F4" : undefined);
                      return color ? (
                        <span
                          className="inline-block w-3 h-3 rounded-full shrink-0 border border-white/20"
                          style={{ backgroundColor: color }}
                        />
                      ) : null;
                    })()}
                  </div>
                  {/* 追加ボタン */}
                  <Button
                    size="sm"
                    onClick={handleExportGCal}
                    disabled={weeksToPrint.length === 0 || gcalProgress.status === "running"}
                    className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white shrink-0 min-w-[130px] justify-center"
                  >
                    {gcalProgress.status === "running" ? (
                      <><Loader2 size={12} className="animate-spin" />追加中...</>
                    ) : (
                      <><CalendarDays size={12} />カレンダーに追加</>
                    )}
                  </Button>
                </div>
                {/* 進捗・結果表示 */}
                {gcalProgress.status === "running" && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" />追加中...</span>
                      <span className="font-mono">{gcalProgress.done} / {gcalProgress.total} 件</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: gcalProgress.total > 0 ? `${(gcalProgress.done / gcalProgress.total) * 100}%` : "0%" }}
                      />
                    </div>
                  </div>
                )}
                {gcalProgress.status === "done" && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="flex items-center gap-1 text-green-500">
                      <CheckCircle2 size={12} />
                      {gcalProgress.inserted > 0 && `新規 ${gcalProgress.inserted}件`}
                      {gcalProgress.updated > 0 && `${gcalProgress.inserted > 0 ? " / " : ""}更新 ${gcalProgress.updated}件`}
                      {gcalProgress.inserted === 0 && gcalProgress.updated === 0 && "完了"}
                    </span>
                    {gcalProgress.errors > 0 && (
                      <span className="text-amber-400">(エラー: {gcalProgress.errors}件)</span>
                    )}
                    <a
                      href="https://calendar.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 text-blue-400 hover:underline"
                    >
                      Googleカレンダーを開く <ExternalLink size={10} />
                    </a>
                    <button
                      onClick={() => setGcalProgress(prev => ({ ...prev, status: "idle", done: 0, total: 0, inserted: 0, updated: 0, errors: 0 }))}
                      className="text-muted-foreground hover:text-foreground underline"
                    >
                      もう一度追加
                    </button>
                  </div>
                )}
                {gcalProgress.status === "error" && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertCircle size={12} />
                      追加に失敗しました。トークンが切れている場合は再ログインしてください。
                    </span>
                    <button
                      onClick={() => setGcalProgress(prev => ({ ...prev, status: "idle" }))}
                      className="text-muted-foreground hover:text-foreground underline"
                    >
                      再試行
                    </button>
                  </div>
                )}
                {/* 削除セクション */}
                <div className="border-t border-border/50 pt-3 mt-2 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle size={12} className="text-red-400 shrink-0" />
                    <span className="text-xs font-medium text-red-400">Googleカレンダーからイベントを削除</span>
                  </div>

                  {/* モード選択 */}
                  {gcalDeleteProgress.status === "idle" && !showDeleteConfirm && (
                    <div className="space-y-1.5">
                      <label className="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="radio"
                          name="deleteMode"
                          value="tagged"
                          checked={deleteMode === "tagged"}
                          onChange={() => setDeleteMode("tagged")}
                          className="mt-0.5 accent-red-500"
                        />
                        <div>
                          <span className="text-xs font-medium">このアプリで追加したイベントのみ削除</span>
                          <p className="text-xs text-muted-foreground">「カレンダーに追加」ボタンで追加したイベントを削除します。他のイベントには影響しません。</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="radio"
                          name="deleteMode"
                          value="range"
                          checked={deleteMode === "range"}
                          onChange={() => setDeleteMode("range")}
                          className="mt-0.5 accent-red-500"
                        />
                        <div className="flex-1">
                          <span className="text-xs font-medium">期間を指定してすべて削除</span>
                          <p className="text-xs text-muted-foreground">⚠️ 旧バージョンで追加したイベントも含め、指定期間内の<strong>すべてのイベント</strong>を削除します。他のイベントも削除されます。</p>
                          {deleteMode === "range" && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <input
                                type="date"
                                value={deleteRangeStart}
                                onChange={e => setDeleteRangeStart(e.target.value)}
                                className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground"
                              />
                              <span className="text-xs text-muted-foreground">〜</span>
                              <input
                                type="date"
                                value={deleteRangeEnd}
                                onChange={e => setDeleteRangeEnd(e.target.value)}
                                className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground"
                              />
                            </div>
                          )}
                        </div>
                      </label>
                    </div>
                  )}

                  {/* 削除ボタン（idle時） */}
                  {gcalDeleteProgress.status === "idle" && !showDeleteConfirm && (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deleteMode === "range" && (!deleteRangeStart || !deleteRangeEnd)}
                      className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      削除を実行する...
                    </button>
                  )}

                  {/* 確認ステップ */}
                  {showDeleteConfirm && gcalDeleteProgress.status === "idle" && (
                    <div className="rounded border border-red-500/40 bg-red-500/5 p-3 space-y-2">
                      <div className="flex items-start gap-1.5">
                        <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-red-400">本当に削除しますか？この操作は元に戻せません。</p>
                          {deleteMode === "tagged" ? (
                            <p className="text-xs text-muted-foreground">
                              対象カレンダー：<strong>「{gcalCalendars.find(c => c.id === gcalCalendarId)?.summary ?? "メインカレンダー"}」</strong><br />
                              このアプリで追加したすべての時間割イベントを削除します。
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              対象カレンダー：<strong>「{gcalCalendars.find(c => c.id === gcalCalendarId)?.summary ?? "メインカレンダー"}」</strong><br />
                              期間：<strong>{deleteRangeStart} 〜 {deleteRangeEnd}</strong><br />
                              ⚠️ この期間内の<strong>すべてのイベント</strong>（他のイベントも含む）が削除されます。
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="destructive" onClick={handleDeleteGCal} className="h-7 text-xs px-3 gap-1">
                          <AlertCircle size={11} />
                          削除する
                        </Button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="text-xs text-muted-foreground hover:text-foreground underline"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 進捗 */}
                  {gcalDeleteProgress.status === "running" && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" />削除中... 中断しないでください</span>
                        <span className="font-mono">{gcalDeleteProgress.done} / {gcalDeleteProgress.total > 0 ? gcalDeleteProgress.total : "?"} 件</span>
                      </div>
                      {gcalDeleteProgress.total > 0 && (
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div className="bg-red-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${(gcalDeleteProgress.done / gcalDeleteProgress.total) * 100}%` }} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 完了 */}
                  {gcalDeleteProgress.status === "done" && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1 text-green-500">
                        <CheckCircle2 size={12} />
                        {gcalDeleteProgress.deleted}件削除完了
                        {gcalDeleteProgress.errors > 0 && `（エラー: ${gcalDeleteProgress.errors}件）`}
                      </span>
                      <button
                        onClick={() => { setGcalDeleteProgress(prev => ({ ...prev, status: "idle" })); setShowDeleteConfirm(false); }}
                        className="text-muted-foreground hover:text-foreground underline"
                      >
                        閉じる
                      </button>
                    </div>
                  )}

                  {/* エラー */}
                  {gcalDeleteProgress.status === "error" && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1 text-red-400">
                        <AlertCircle size={12} />
                        削除に失敗しました。トークンが切れている場合は再ログインしてください。
                      </span>
                      <button
                        onClick={() => { setGcalDeleteProgress(prev => ({ ...prev, status: "idle" })); setShowDeleteConfirm(false); }}
                        className="text-muted-foreground hover:text-foreground underline"
                      >
                        閉じる
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 生データ タブ選択時 */}
        {format === "raw" && (
          <div className="px-5 py-4 border-t border-border bg-muted/20 space-y-3">
            <div className="flex items-center gap-2">
              <Database size={13} className="text-muted-foreground" />
              <span className="text-xs font-medium">生データ書き出し</span>
            </div>
            <p className="text-xs text-muted-foreground">時間割データをそのままファイルとして書き出します。バックアップや他ツールとの連携に使用できます。</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={exportCSV} className="h-7 text-xs gap-1.5">
                <span className="font-mono text-muted-foreground text-[10px]">.csv</span>
                CSV形式でダウンロード
              </Button>
              <Button size="sm" variant="outline" onClick={exportEffective} className="h-7 text-xs gap-1.5">
                <span className="font-mono text-muted-foreground text-[10px]">.json</span>
                確定データ（JSON）
              </Button>
              <Button size="sm" variant="outline" onClick={exportOverride} className="h-7 text-xs gap-1.5">
                <span className="font-mono text-muted-foreground text-[10px]">.json</span>
                変更履歴（JSON）
              </Button>
            </div>
          </div>
        )}
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
              ) : format === "raw" ? (
                <><Database size={13} />生データを書き出し</>
              ) : format === "ics" ? (
                <><CalendarDays size={13} />ICSでダウンロード</>
              ) : (
                <><FileText size={13} />PDFでダウンロード</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
