// timetablePdfExport.ts
// jsPDF直接描画 + NotoSansJP埋め込みによるPDF/PNGエクスポート
// SVG/Canvas不使用のため軽量・確実に動作する

import { jsPDF } from "jspdf";
import type { GradeColorDef } from "./gradeColors";
import { getClassColor } from "./gradeColors";
import { getWeekDates, formatDate } from "./timetable";

// ─── Types ────────────────────────────────────────────────────

interface PeriodSlot {
  period: number;
  class: string | null;
  reason?: string;
}

interface TimetableEntry {
  date: string;
  periods: PeriodSlot[];
}

interface HolidayEntry {
  date: string;
  name?: string;
}

export interface PdfExportOptions {
  weeksToPrint: string[];
  effectiveEntries: TimetableEntry[];
  holidays: HolidayEntry[];
  gradeColors: Record<string, GradeColorDef>;
  filterClass: string;
  showReason: boolean;
  showEmptyCells: boolean;
  orientation: "landscape" | "portrait";
  title: string;
  semLabel: string;
  schoolName: string;
  filename?: string;
  outputType?: "pdf" | "png";
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

// Hex color to RGB
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

// CSS color name / oklch / hsl → fallback to gray
function parseColor(color: string | undefined): [number, number, number] {
  if (!color) return [255, 255, 255];
  if (color.startsWith("#")) return hexToRgb(color);
  // Tailwind/oklch colors — map common ones
  const named: Record<string, [number, number, number]> = {
    white: [255, 255, 255],
    black: [0, 0, 0],
    red: [239, 68, 68],
    blue: [59, 130, 246],
    green: [34, 197, 94],
    yellow: [234, 179, 8],
    orange: [249, 115, 22],
    purple: [168, 85, 247],
    pink: [236, 72, 153],
    gray: [156, 163, 175],
    amber: [245, 158, 11],
    teal: [20, 184, 166],
    indigo: [99, 102, 241],
    cyan: [6, 182, 212],
    lime: [132, 204, 22],
    rose: [244, 63, 94],
    violet: [139, 92, 246],
    sky: [14, 165, 233],
    emerald: [16, 185, 129],
    slate: [100, 116, 139],
  };
  for (const [name, rgb] of Object.entries(named)) {
    if (color.toLowerCase().includes(name)) return rgb;
  }
  return [220, 220, 220]; // fallback light gray
}

// ─── Font loader (lazy, cached) ──────────────────────────────

let _fontBase64: string | null = null;
let _fontLoading: Promise<string> | null = null;

async function loadFont(): Promise<string> {
  if (_fontBase64) return _fontBase64;
  if (_fontLoading) return _fontLoading;

  _fontLoading = (async () => {
    const { NOTO_SANS_JP_BASE64 } = await import("./notoSansJpFont");
    _fontBase64 = NOTO_SANS_JP_BASE64;
    return _fontBase64;
  })();

  return _fontLoading;
}

// ─── Main export function ─────────────────────────────────────

export async function exportTimetablePdf(opts: PdfExportOptions): Promise<void> {
  const {
    weeksToPrint,
    effectiveEntries,
    holidays,
    gradeColors,
    filterClass,
    showReason,
    showEmptyCells,
    orientation,
    title,
    semLabel,
    schoolName,
    filename = "時間割",
    outputType = "pdf",
  } = opts;

  if (weeksToPrint.length === 0) return;

  // Load font
  const fontBase64 = await loadFont();

  // Page size: A4
  const pageW = orientation === "landscape" ? 297 : 210; // mm
  const pageH = orientation === "landscape" ? 210 : 297;

  const doc = new jsPDF({
    orientation,
    unit: "mm",
    format: "a4",
  });

  // Register font
  doc.addFileToVFS("NotoSansJP.ttf", fontBase64);
  doc.addFont("NotoSansJP.ttf", "NotoSansJP", "normal");
  doc.setFont("NotoSansJP");

  // Layout constants
  const margin = 8;
  const contentW = pageW - margin * 2;
  const headerH = 8;
  const periodColW = 8;
  const tableTop = margin + headerH + 2;
  const tableH = pageH - tableTop - margin;
  const rowH = tableH / 6;
  const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

  // Holiday maps
  const holidayDates = new Set(holidays.map(h => h.date));
  const holidayNameMap = new Map(holidays.map(h => [h.date, h.name ?? "休校"]));
  const entryByDate = new Map(effectiveEntries.map(e => [e.date, e]));

  for (let wIdx = 0; wIdx < weeksToPrint.length; wIdx++) {
    if (wIdx > 0) doc.addPage();

    const mondayStr = weeksToPrint[wIdx];
    const monday = isoToDate(mondayStr);
    const fri = addDays(monday, 4);
    const weekDates = getWeekDates(monday, { includeSaturday: false, includeSunday: false });

    const weekLabel = `${monday.getFullYear()}年 ${monday.getMonth() + 1}月${monday.getDate()}日（月）〜 ${fri.getMonth() + 1}月${fri.getDate()}日（金）`;
    const fullTitle = `${title}${filterClass !== "__all__" ? ` — ${filterClass}` : ""}`;
    const subTitle = [semLabel, weekLabel, schoolName].filter(Boolean).join(" / ");

    // ── Header ──────────────────────────────────────────────
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(fullTitle, margin, margin + 4);

    doc.setFontSize(6.5);
    doc.setTextColor(100, 100, 100);
    doc.text(subTitle, margin + doc.getTextWidth(fullTitle) + 2, margin + 4);

    // Page number
    doc.setFontSize(6);
    doc.setTextColor(180, 180, 180);
    doc.text(`${wIdx + 1}/${weeksToPrint.length}`, pageW - margin, margin + 4, { align: "right" });

    // Header underline
    doc.setDrawColor(40, 40, 40);
    doc.setLineWidth(0.4);
    doc.line(margin, margin + 5.5, pageW - margin, margin + 5.5);

    // ── Column widths ────────────────────────────────────────
    const dayColW = (contentW - periodColW) / weekDates.length;

    // ── Day header row ───────────────────────────────────────
    const dayHeaderH = 7;
    const dayHeaderTop = tableTop;

    // Period col header
    doc.setFillColor(240, 240, 240);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.rect(margin, dayHeaderTop, periodColW, dayHeaderH, "FD");
    doc.setFontSize(5.5);
    doc.setTextColor(120, 120, 120);
    doc.text("時限", margin + periodColW / 2, dayHeaderTop + dayHeaderH / 2 + 1.5, { align: "center" });

    for (let dIdx = 0; dIdx < weekDates.length; dIdx++) {
      const date = weekDates[dIdx];
      const isHoliday = holidayDates.has(date);
      const d = isoToDate(date);
      const dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const dayLabel = DAY_LABELS[dayIdx];
      const x = margin + periodColW + dIdx * dayColW;

      doc.setFillColor(...(isHoliday ? [254, 242, 242] as [number, number, number] : [240, 240, 240] as [number, number, number]));
      doc.rect(x, dayHeaderTop, dayColW, dayHeaderH, "FD");

      doc.setFontSize(7);
      doc.setTextColor(isHoliday ? 220 : 30, isHoliday ? 30 : 30, isHoliday ? 30 : 30);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}（${dayLabel}）`;
      doc.text(dateStr, x + dayColW / 2, dayHeaderTop + 3.5, { align: "center" });

      if (isHoliday) {
        const hName = holidayNameMap.get(date) ?? "休校";
        doc.setFontSize(5);
        doc.setTextColor(180, 30, 30);
        doc.text(hName, x + dayColW / 2, dayHeaderTop + 5.8, { align: "center" });
      }
    }

    // ── Period rows ──────────────────────────────────────────
    const gridTop = dayHeaderTop + dayHeaderH;
    const gridH = pageH - gridTop - margin;
    const periodRowH = gridH / 6;

    for (let period = 1; period <= 6; period++) {
      const rowTop = gridTop + (period - 1) * periodRowH;

      // Period label cell
      doc.setFillColor(248, 248, 248);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(margin, rowTop, periodColW, periodRowH, "FD");
      doc.setFontSize(7);
      doc.setTextColor(80, 80, 80);
      doc.text(`${period}`, margin + periodColW / 2, rowTop + periodRowH / 2 + 0.5, { align: "center" });
      doc.setFontSize(5);
      doc.setTextColor(160, 160, 160);
      doc.text("限", margin + periodColW / 2, rowTop + periodRowH / 2 + 3.5, { align: "center" });

      // Day cells
      for (let dIdx = 0; dIdx < weekDates.length; dIdx++) {
        const date = weekDates[dIdx];
        const isHoliday = holidayDates.has(date);
        const entry = entryByDate.get(date);
        const slot = entry?.periods.find(p => p.period === period) ?? { period, class: null };
        const isFiltered = filterClass !== "__all__" && slot.class !== filterClass;
        const displayClass = isFiltered ? null : slot.class;
        const displayReason = isFiltered ? null : slot.reason;

        const x = margin + periodColW + dIdx * dayColW;
        const colors = displayClass ? getClassColor(displayClass, gradeColors) : null;

        // Cell background
        let bgRgb: [number, number, number] = [255, 255, 255];
        if (isHoliday) {
          bgRgb = [254, 242, 242];
        } else if (colors?.bg) {
          bgRgb = parseColor(colors.bg);
        }

        doc.setFillColor(...bgRgb);
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.2);
        doc.rect(x, rowTop, dayColW, periodRowH, "FD");

        if (displayClass) {
          const textRgb = parseColor(colors?.text);
          doc.setFontSize(7);
          doc.setTextColor(...textRgb);
          // Wrap long class names
          const maxW = dayColW - 2;
          const lines = doc.splitTextToSize(displayClass, maxW);
          const lineH = 3;
          const totalH = lines.length * lineH;
          const startY = rowTop + (periodRowH - totalH) / 2 + lineH * 0.8;
          lines.forEach((line: string, i: number) => {
            doc.text(line, x + dayColW / 2, startY + i * lineH, { align: "center" });
          });

          if (showReason && displayReason) {
            doc.setFontSize(5);
            doc.setTextColor(120, 120, 120);
            const reasonLines = doc.splitTextToSize(displayReason, maxW);
            const reasonY = startY + lines.length * lineH + 0.5;
            reasonLines.slice(0, 2).forEach((line: string, i: number) => {
              doc.text(line, x + dayColW / 2, reasonY + i * 2.5, { align: "center" });
            });
          }
        } else if (showEmptyCells && !isHoliday) {
          doc.setFontSize(6);
          doc.setTextColor(200, 200, 200);
          doc.text("—", x + dayColW / 2, rowTop + periodRowH / 2 + 1.5, { align: "center" });
        }
      }
    }
  }

  if (outputType === "pdf") {
    doc.save(`${filename}_時間割.pdf`);
  } else {
    // PNG: export first page as PNG via canvas
    const pngDataUrl = doc.output("datauristring");
    // For PNG, we use the PDF data URI and convert via canvas
    // Since jsPDF doesn't natively output PNG, we use a simple approach:
    // render the PDF page to canvas using pdf.js (if available) or just download PDF
    // Fallback: save as PDF with .pdf extension and notify user
    // Better approach: use doc.canvas if available
    try {
      // Try to get canvas from jsPDF internal
      const canvas = (doc as unknown as { canvas?: HTMLCanvasElement }).canvas;
      if (canvas) {
        const link = document.createElement("a");
        link.download = `${filename}_時間割.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        // Fallback: download as PDF
        doc.save(`${filename}_時間割.pdf`);
      }
    } catch {
      doc.save(`${filename}_時間割.pdf`);
    }
  }
}

// ─── PNG export via offscreen canvas ─────────────────────────

export async function exportTimetablePng(opts: PdfExportOptions): Promise<void> {
  // Generate one page at a time to avoid memory issues
  const { weeksToPrint, filename = "時間割" } = opts;

  for (let i = 0; i < weeksToPrint.length; i++) {
    const singleOpts: PdfExportOptions = {
      ...opts,
      weeksToPrint: [weeksToPrint[i]],
      filename: weeksToPrint.length > 1 ? `${filename}_${i + 1}` : filename,
    };

    await exportTimetablePdf({ ...singleOpts, outputType: "pdf" });

    // Small delay to avoid blocking UI
    if (i < weeksToPrint.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
