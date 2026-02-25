// timetableSvgExport.ts
// SVGで時間割を直接描画してPNG/PDFをエクスポートする
// html2canvasを使わないため、CSS変数・Shadow DOMに依存せず確実に動作する

import type { TimetableEntry, PeriodSlot } from "./timetable";
import type { GradeColorDef } from "./gradeColors";
import { getClassColor } from "./gradeColors";
import { getWeekDates, formatDateJP, getMondayOfWeek, formatDate } from "./timetable";

// ─── Types ────────────────────────────────────────────────────

export interface SvgExportOptions {
  effectiveEntries: TimetableEntry[];
  weekMondayStrs: string[];
  title: string;
  filterClass: string | null;
  gradeColors: Record<string, GradeColorDef>;
  showReason: boolean;
  showEmptyCells: boolean;
  holidays: { date: string; name?: string }[];
  orientation: "landscape" | "portrait";
}

// ─── Layout constants ─────────────────────────────────────────

// A4 at 96dpi: landscape=1122x794, portrait=794x1122
// PNG export uses 1x scale to avoid memory issues (still crisp enough for screen)
const SCALE = 2;
const PNG_SCALE = 1; // PNG用: 1x (メモリ節約)、PDFは2x
const A4_L_W = 1122;
const A4_L_H = 794;
const A4_P_W = 794;
const A4_P_H = 1122;

// ─── Color helpers ────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

// ─── SVG builder for one week ────────────────────────────────

function buildWeekSvg(
  mondayStr: string,
  options: SvgExportOptions,
  pageW: number,
  pageH: number,
): string {
  const {
    effectiveEntries,
    title,
    filterClass,
    gradeColors,
    showReason,
    showEmptyCells,
    holidays,
  } = options;

  const holidaySet = new Set(holidays.map(h => h.date));
  const holidayNameMap = new Map(holidays.map(h => [h.date, h.name]));
  const entryByDate = new Map(effectiveEntries.map(e => [e.date, e]));

  const monday = new Date(mondayStr + "T00:00:00");
  const fri = new Date(monday);
  fri.setDate(fri.getDate() + 4);
  const weekDates = getWeekDates(monday, { includeSaturday: false, includeSunday: false });

  const weekLabel = `${monday.getFullYear()}年 ${monday.getMonth() + 1}月${monday.getDate()}日（月）〜 ${fri.getMonth() + 1}月${fri.getDate()}日（金）`;
  const displayTitle = filterClass ? `${title} — ${filterClass}` : title;

  // Layout
  const margin = 32 * SCALE;
  const headerH = 28 * SCALE;
  const colW = Math.floor((pageW * SCALE - margin * 2 - 36 * SCALE) / weekDates.length);
  const periodColW = 36 * SCALE;
  const rowH = showReason ? 44 * SCALE : 36 * SCALE;
  const theadH = 32 * SCALE;
  const periods = [1, 2, 3, 4, 5, 6];

  const svgW = pageW * SCALE;
  const svgH = pageH * SCALE;

  const tableX = margin;
  const tableY = margin + headerH + 8 * SCALE;
  const tableW = periodColW + colW * weekDates.length;

  // Font sizes (scaled)
  const fs_title = 13 * SCALE;
  const fs_subtitle = 8 * SCALE;
  const fs_header = 9 * SCALE;
  const fs_class = 9 * SCALE;
  const fs_reason = 7 * SCALE;
  const fs_period = 9 * SCALE;
  const fs_holiday = 7 * SCALE;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="white"/>`;

  // ── Header ──────────────────────────────────────────────────
  svg += `<text x="${margin}" y="${margin + fs_title}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_title}" font-weight="bold" fill="#1a1a2e">${escXml(displayTitle)}</text>`;
  svg += `<text x="${margin}" y="${margin + fs_title + fs_subtitle + 4 * SCALE}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_subtitle}" fill="#666">${escXml(weekLabel)}</text>`;

  // Header underline
  svg += `<line x1="${margin}" y1="${tableY - 4 * SCALE}" x2="${margin + tableW}" y2="${tableY - 4 * SCALE}" stroke="#1a1a2e" stroke-width="${1.5 * SCALE}"/>`;

  // ── Table header row ─────────────────────────────────────────
  // Period col header
  svg += `<rect x="${tableX}" y="${tableY}" width="${periodColW}" height="${theadH}" fill="#f0f0f0" stroke="#ccc" stroke-width="${SCALE}"/>`;
  svg += `<text x="${tableX + periodColW / 2}" y="${tableY + theadH / 2 + fs_header / 3}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_header}" fill="#666" text-anchor="middle">\u6642\u9650</text>`;

  weekDates.forEach((date, di) => {
    const cx = tableX + periodColW + di * colW;
    const isHoliday = holidaySet.has(date);
    const bgColor = isHoliday ? "#fef2f2" : "#f0f0f0";
    svg += `<rect x="${cx}" y="${tableY}" width="${colW}" height="${theadH}" fill="${bgColor}" stroke="#ccc" stroke-width="${SCALE}"/>`;
    svg += `<text x="${cx + colW / 2}" y="${tableY + theadH / 2 + fs_header / 3 - (isHoliday ? fs_holiday * 0.8 : 0)}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_header}" font-weight="bold" fill="${isHoliday ? '#991b1b' : '#333'}" text-anchor="middle">${escXml(formatDateJP(date))}</text>`;
    if (isHoliday) {
      const hName = holidayNameMap.get(date) ?? "休校";
      svg += `<text x="${cx + colW / 2}" y="${tableY + theadH / 2 + fs_header / 3 + fs_holiday + 2 * SCALE}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_holiday}" fill="#991b1b" text-anchor="middle">${escXml(hName)}</text>`;
    }
  });

  // ── Table data rows ──────────────────────────────────────────
  periods.forEach((period, pi) => {
    const ry = tableY + theadH + pi * rowH;

    // Period number cell
    svg += `<rect x="${tableX}" y="${ry}" width="${periodColW}" height="${rowH}" fill="#f8f8f8" stroke="#ddd" stroke-width="${SCALE}"/>`;
    svg += `<text x="${tableX + periodColW / 2}" y="${ry + rowH / 2 + fs_period / 3}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_period}" font-weight="bold" fill="#555" text-anchor="middle">${period}\u9650</text>`;

    weekDates.forEach((date, di) => {
      const cx = tableX + periodColW + di * colW;
      const entry = entryByDate.get(date);
      const slot = entry?.periods.find(p => p.period === period);
      const isHoliday = holidaySet.has(date);

      const isFiltered = filterClass && slot?.class !== filterClass;
      const displayClass = isFiltered ? null : (slot?.class ?? null);
      const displayReason = isFiltered ? null : (slot?.reason ?? null);

      const colors = displayClass ? getClassColor(displayClass, gradeColors) : null;
      const bgColor = isHoliday ? "#fef2f2" : (colors?.bg ?? "#ffffff");
      const textColor = colors?.text ?? "#333";

      svg += `<rect x="${cx}" y="${ry}" width="${colW}" height="${rowH}" fill="${bgColor}" stroke="#ddd" stroke-width="${SCALE}"/>`;

      if (displayClass) {
        const textY = showReason && displayReason
          ? ry + rowH / 2 - fs_class * 0.3
          : ry + rowH / 2 + fs_class / 3;
        svg += `<text x="${cx + colW / 2}" y="${textY}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_class}" font-weight="bold" fill="${textColor}" text-anchor="middle">${escXml(displayClass)}</text>`;
        if (showReason && displayReason) {
          svg += `<text x="${cx + colW / 2}" y="${ry + rowH / 2 + fs_class * 0.8}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_reason}" fill="#777" text-anchor="middle">${escXml(displayReason)}</text>`;
        }
      } else if (!isHoliday && showEmptyCells) {
        svg += `<text x="${cx + colW / 2}" y="${ry + rowH / 2 + fs_class / 3}" font-family="'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif" font-size="${fs_class}" fill="#ccc" text-anchor="middle">—</text>`;
      }
    });
  });

  // Bottom border
  const tableBottom = tableY + theadH + periods.length * rowH;
  svg += `<line x1="${tableX}" y1="${tableBottom}" x2="${tableX + tableW}" y2="${tableBottom}" stroke="#ccc" stroke-width="${SCALE}"/>`;

  // Page number (bottom right)
  svg += `<text x="${svgW - margin}" y="${svgH - margin / 2}" font-family="'Helvetica Neue',Arial,sans-serif" font-size="${fs_subtitle}" fill="#aaa" text-anchor="end">\u51fa\u529b: ${new Date().toLocaleDateString("ja-JP")}</text>`;

  svg += `</svg>`;
  return svg;
}

// ─── XML escape ──────────────────────────────────────────────

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── SVG → Canvas ────────────────────────────────────────────

async function svgToCanvas(svgStr: string, w: number, h: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * SCALE;
      canvas.height = h * SCALE;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// ─── SVG → Canvas (PNG_SCALE版) ─────────────────────────────

async function svgToCanvasPNG(svgStr: string, w: number, h: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * PNG_SCALE;
      canvas.height = h * PNG_SCALE;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// ─── Public: Export PNG ──────────────────────────────────────
// 週ごとに個別PNGファイルをダウンロード（巨大Canvas回避）

export async function exportTimetablePNG(
  options: SvgExportOptions,
  filename: string,
): Promise<void> {
  const { orientation } = options;
  const pageW = orientation === "landscape" ? A4_L_W : A4_P_W;
  const pageH = orientation === "landscape" ? A4_L_H : A4_P_H;

  if (options.weekMondayStrs.length === 0) return;

  const baseName = filename.replace(/\.png$/i, "");
  const isSingle = options.weekMondayStrs.length === 1;

  for (let i = 0; i < options.weekMondayStrs.length; i++) {
    const mondayStr = options.weekMondayStrs[i];
    const svgStr = buildWeekSvg(mondayStr, options, pageW, pageH);
    const canvas = await svgToCanvasPNG(svgStr, pageW, pageH);

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    // 複数週の場合は連番付き
    a.download = isSingle ? `${baseName}.png` : `${baseName}_${String(i + 1).padStart(2, "0")}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // ブラウザのダウンロードキューが詰まらないよう少し待つ
    if (i < options.weekMondayStrs.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

// ─── Public: Export PDF ──────────────────────────────────────

export async function exportTimetablePDF(
  options: SvgExportOptions,
  filename: string,
): Promise<void> {
  const { orientation } = options;
  const pageW = orientation === "landscape" ? A4_L_W : A4_P_W;
  const pageH = orientation === "landscape" ? A4_L_H : A4_P_H;

  if (options.weekMondayStrs.length === 0) return;

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [pageW, pageH],
    hotfixes: ["px_scaling"],
  });

  for (let i = 0; i < options.weekMondayStrs.length; i++) {
    const svgStr = buildWeekSvg(options.weekMondayStrs[i], options, pageW, pageH);
    const canvas = await svgToCanvas(svgStr, pageW, pageH);
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    if (i > 0) pdf.addPage([pageW, pageH], orientation);
    pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
  }

  pdf.save(filename);
}
