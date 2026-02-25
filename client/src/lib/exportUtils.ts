// exportUtils.ts
// Design: Swiss Grid × Japanese Functional Design
// エクスポートユーティリティ: 年間集計CSV・Excel・PDF・PNG

import { downloadFile } from "./timetable";
import type { TimetableFile } from "./timetableFile";
import type { ClassStats } from "./timetable";

// ─── 年間集計 CSV ─────────────────────────────────────────────

export interface AnnualClassStat {
  class: string;
  grade: string;
  total: number;
  completed: number;
  remaining: number;
  completionRate: number;
  byTerm: { term: string; total: number; completed: number }[];
}

export function exportAnnualStatsCSV(
  stats: AnnualClassStat[],
  termLabels: string[],
  title: string,
): void {
  const BOM = "\uFEFF";
  const rows: string[][] = [];

  // Header
  const header = ["クラス", "学年", ...termLabels.flatMap(t => [`${t}コマ数`, `${t}実施済み`]), "年間合計", "実施済み", "残り", "達成率(%)"];
  rows.push(header);

  // Data rows
  for (const s of stats) {
    const termCols = termLabels.flatMap(t => {
      const td = s.byTerm.find(b => b.term === t);
      return [String(td?.total ?? 0), String(td?.completed ?? 0)];
    });
    rows.push([
      s.class,
      s.grade,
      ...termCols,
      String(s.total),
      String(s.completed),
      String(s.remaining),
      String(Math.round(s.completionRate * 100)),
    ]);
  }

  const csv = BOM + rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  downloadFile(csv, `${title}_年間集計.csv`, "text/csv;charset=utf-8");
}

// ─── 年間集計 Excel ───────────────────────────────────────────

export async function exportAnnualStatsExcel(
  stats: AnnualClassStat[],
  termLabels: string[],
  title: string,
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "時間割管理アプリ";
  wb.created = new Date();

  const ws = wb.addWorksheet("年間集計");

  // Column definitions
  const cols = [
    { header: "クラス", key: "class", width: 12 },
    { header: "学年", key: "grade", width: 8 },
    ...termLabels.flatMap(t => [
      { header: `${t}コマ数`, key: `${t}_total`, width: 10 },
      { header: `${t}実施済み`, key: `${t}_done`, width: 10 },
    ]),
    { header: "年間合計", key: "total", width: 10 },
    { header: "実施済み", key: "completed", width: 10 },
    { header: "残り", key: "remaining", width: 8 },
    { header: "達成率(%)", key: "rate", width: 10 },
  ];
  ws.columns = cols;

  // Header style
  const headerRow = ws.getRow(1);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B5998" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
  });
  headerRow.height = 20;

  // Data rows
  for (const s of stats) {
    const rowData: Record<string, string | number> = {
      class: s.class,
      grade: s.grade,
      total: s.total,
      completed: s.completed,
      remaining: s.remaining,
      rate: Math.round(s.completionRate * 100),
    };
    for (const t of termLabels) {
      const td = s.byTerm.find(b => b.term === t);
      rowData[`${t}_total`] = td?.total ?? 0;
      rowData[`${t}_done`] = td?.completed ?? 0;
    }
    const row = ws.addRow(rowData);

    // Alternating row color
    const isEven = ws.rowCount % 2 === 0;
    row.eachCell(cell => {
      cell.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: isEven ? "FFF0F4FF" : "FFFFFFFF" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE0E0E0" } },
        bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
        left: { style: "thin", color: { argb: "FFE0E0E0" } },
        right: { style: "thin", color: { argb: "FFE0E0E0" } },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    // Class name left-align
    row.getCell("class").alignment = { horizontal: "left", vertical: "middle" };

    // Color rate cell
    const rateCell = row.getCell("rate");
    const rate = s.completionRate;
    rateCell.font = {
      bold: true,
      color: { argb: rate >= 0.9 ? "FF16A34A" : rate >= 0.5 ? "FFD97706" : "FFDC2626" },
    };
  }

  // Title row at top
  ws.spliceRows(1, 0, [`${title} 年間集計`]);
  const titleRow = ws.getRow(1);
  titleRow.getCell(1).font = { bold: true, size: 14 };
  titleRow.getCell(1).value = `${title} 年間集計`;
  ws.mergeCells(1, 1, 1, cols.length);
  titleRow.height = 24;

  // Freeze header
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2 }];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title}_年間集計.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 時間割 Excel（先生向けシンプル版）────────────────────────

export async function exportTimetableExcel(
  effectiveEntries: import("./timetable").TimetableEntry[],
  weekMondayStrs: string[],
  title: string,
  filterClass: string | null,
  gradeColors: Record<string, import("./gradeColors").GradeColorDef>,
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const { getClassColor } = await import("./gradeColors");
  const { getMondayOfWeek, getWeekDates, formatDateJP } = await import("./timetable");

  const wb = new ExcelJS.Workbook();
  wb.creator = "時間割管理アプリ";
  wb.created = new Date();

  const entryByDate = new Map(effectiveEntries.map(e => [e.date, e]));

  for (const mondayStr of weekMondayStrs) {
    const monday = new Date(mondayStr + "T00:00:00");
    const fri = new Date(monday);
    fri.setDate(fri.getDate() + 4);
    const sheetName = `${monday.getMonth() + 1}月${monday.getDate()}日週`;
    const ws = wb.addWorksheet(sheetName);

    const weekDates = getWeekDates(monday, { includeSaturday: false, includeSunday: false });

    // Header row: 時限 + 曜日
    ws.columns = [
      { header: "時限", key: "period", width: 6 },
      ...weekDates.map((date, i) => ({
        header: formatDateJP(date),
        key: `d${i}`,
        width: 14,
      })),
    ];

    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" }, bottom: { style: "medium" },
        left: { style: "thin" }, right: { style: "thin" },
      };
    });
    headerRow.height = 18;

    // Data rows
    for (let period = 1; period <= 6; period++) {
      const rowData: Record<string, string | number> = { period };
      for (let di = 0; di < weekDates.length; di++) {
        const date = weekDates[di];
        const entry = entryByDate.get(date);
        const slot = entry?.periods.find(p => p.period === period);
        const cls = slot?.class ?? "";
        if (filterClass && cls !== filterClass) {
          rowData[`d${di}`] = "";
        } else {
          rowData[`d${di}`] = cls;
        }
      }
      const row = ws.addRow(rowData);
      row.height = 22;

      // Style cells
      for (let di = 0; di < weekDates.length; di++) {
        const date = weekDates[di];
        const entry = entryByDate.get(date);
        const slot = entry?.periods.find(p => p.period === period);
        const cls = filterClass && slot?.class !== filterClass ? null : slot?.class;
        const cell = row.getCell(`d${di}`);

        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE0E0E0" } },
          bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
          left: { style: "thin", color: { argb: "FFE0E0E0" } },
          right: { style: "thin", color: { argb: "FFE0E0E0" } },
        };

        if (cls) {
          const colors = getClassColor(cls, gradeColors);
          // Convert CSS hex to ARGB
          const bg = colors.bg.replace("#", "FF").toUpperCase();
          const fg = colors.text.replace("#", "FF").toUpperCase();
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          cell.font = { bold: true, color: { argb: fg } };
        }
      }

      // Period number cell
      const periodCell = row.getCell("period");
      periodCell.font = { bold: true, color: { argb: "FF666666" } };
      periodCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F8F8" } };
      periodCell.alignment = { horizontal: "center", vertical: "middle" };
      periodCell.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: "thin" }, right: { style: "medium" },
      };
    }

    // Freeze header
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title}_時間割.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── PNG エクスポート ─────────────────────────────────────────

export async function exportToPNG(element: HTMLElement, filename: string): Promise<void> {
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

// ─── PDF エクスポート ─────────────────────────────────────────

export async function exportToPDF(element: HTMLElement, filename: string, orientation: "landscape" | "portrait"): Promise<void> {
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;
  const ratio = Math.min(pageWidth / (imgWidth / 2), pageHeight / (imgHeight / 2));
  const w = (imgWidth / 2) * ratio;
  const h = (imgHeight / 2) * ratio;
  const x = (pageWidth - w) / 2;
  const y = (pageHeight - h) / 2;

  pdf.addImage(imgData, "JPEG", x, y, w, h);
  pdf.save(filename);
}
