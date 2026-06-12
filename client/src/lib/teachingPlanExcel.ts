// 指導計画の Excel 書き出し / 読み込み（往復編集対応）
//
// シート構成: 1シート = 1指導計画（学年×教科）
//   A1:"学年" B1:学年 C1:"教科" D1:教科  ← 読み込み時のアンカー（この形のシートだけ取り込む）
//   3行目: テーブルヘッダ（No. / 単元名 / 単元内No. / 内容 / メモ）
//   4行目以降: 授業1コマ = 1行（No.順）
//
// 読み込みルール:
//   - 行の並び順がそのまま通し番号になる（行の挿入・削除で計画が伸縮する）
//   - 「単元名」が連続して同じ行は同じ単元にまとまる（空欄は未割当）
//   - 単元の色・IDは既存計画と単元名が一致すれば引き継ぐ
//   - 行位置が同じ既存コマのID（クラス別の進度メモ等）は温存する
//   - 「単元内No.」列は表示用。読み込み時は無視して自動再計算する

import type { GradeSubjectPlan, TeachingUnit, LessonPlanEntry } from "./timetableFile";

const HEADER_ROW = 3;
const COLS = { no: 1, unit: 2, unitPeriod: 3, content: 4, notes: 5 } as const;

function genId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Excelシート名に使えない文字を除去（31文字制限も考慮） */
function sheetName(grade: string, subject: string): string {
  return `${grade} ${subject}`.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
}

// ─── 書き出し ────────────────────────────────────────────────────────────────

export async function exportTeachingPlansToExcel(
  plans: GradeSubjectPlan[],
  fileTitle: string
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();

  // 使い方シート
  const guide = wb.addWorksheet("使い方");
  guide.columns = [{ width: 90 }];
  const guideLines = [
    "【指導計画 Excel編集ガイド】",
    "",
    "・1シート = 1つの指導計画（学年×教科）です。",
    "・4行目以降の1行が「授業1コマ」です。上から順に通し番号になります。",
    "・行を挿入・削除すると、読み込み時にコマ数が増減します。",
    "・「単元名」が連続して同じ行は、同じ単元としてまとまります。",
    "・「単元内No.」は読み込み時に自動で振り直されるので、編集不要です。",
    "・「内容」「メモ」は自由に編集できます。",
    "・A1セル（学年）の行は編集しないでください（読み込みの目印です）。",
    "",
    "編集が終わったら、アプリの「指導計画」画面 →「Excel読み込み」でこのファイルを選択してください。",
  ];
  guideLines.forEach((text, i) => {
    const cell = guide.getCell(i + 1, 1);
    cell.value = text;
    if (i === 0) cell.font = { bold: true, size: 14 };
  });

  for (const plan of plans) {
    const ws = wb.addWorksheet(sheetName(plan.grade, plan.subject));
    const unitById = new Map(plan.units.map((u) => [u.id, u]));

    // アンカー行
    ws.getCell(1, 1).value = "学年";
    ws.getCell(1, 2).value = plan.grade;
    ws.getCell(1, 3).value = "教科";
    ws.getCell(1, 4).value = plan.subject;
    [1, 3].forEach((c) => {
      ws.getCell(1, c).font = { bold: true, color: { argb: "FF6B7280" } };
    });
    [2, 4].forEach((c) => {
      ws.getCell(1, c).font = { bold: true, size: 12 };
    });

    // テーブルヘッダ
    const headers = ["No.", "単元名", "単元内No.", "内容", "メモ"];
    headers.forEach((h, i) => {
      const cell = ws.getCell(HEADER_ROW, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = { bottom: { style: "thin" } };
    });
    ws.columns = [
      { width: 6 },
      { width: 30 },
      { width: 10 },
      { width: 56 },
      { width: 28 },
    ];

    // 授業行（単元ごとに薄い背景色を交互に）
    let bandToggle = false;
    let prevUnitId: string | null = null;
    plan.lessons.forEach((lesson, idx) => {
      const row = ws.getRow(HEADER_ROW + 1 + idx);
      const unit = unitById.get(lesson.unitId);
      if (lesson.unitId !== prevUnitId) {
        bandToggle = !bandToggle;
        prevUnitId = lesson.unitId;
      }
      row.getCell(COLS.no).value = idx + 1;
      row.getCell(COLS.unit).value = unit?.name ?? "";
      row.getCell(COLS.unitPeriod).value = lesson.unitPeriod;
      row.getCell(COLS.content).value = lesson.content ?? "";
      row.getCell(COLS.notes).value = lesson.notes ?? "";
      row.getCell(COLS.no).alignment = { horizontal: "center" };
      row.getCell(COLS.unitPeriod).alignment = { horizontal: "center" };
      row.getCell(COLS.content).alignment = { wrapText: true, vertical: "top" };
      row.getCell(COLS.notes).alignment = { wrapText: true, vertical: "top" };
      if (bandToggle) {
        for (let c = 1; c <= 5; c++) {
          row.getCell(c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEEF0FF" },
          };
        }
      }
      for (let c = 1; c <= 5; c++) {
        row.getCell(c).border = {
          top: { style: "hair" },
          bottom: { style: "hair" },
          left: { style: "hair" },
          right: { style: "hair" },
        };
      }
    });

    ws.views = [{ state: "frozen", ySplit: HEADER_ROW }];
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `指導計画_${fileTitle || "時間割"}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 読み込み ────────────────────────────────────────────────────────────────

export interface TeachingPlanImportResult {
  plans: GradeSubjectPlan[];
  skippedSheets: string[];
}

export async function importTeachingPlansFromExcel(
  file: File,
  existingPlans: GradeSubjectPlan[]
): Promise<TeachingPlanImportResult> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const existingById = new Map(existingPlans.map((p) => [p.id, p]));
  const plans: GradeSubjectPlan[] = [];
  const skippedSheets: string[] = [];

  wb.eachSheet((ws) => {
    const a1 = String(ws.getCell(1, 1).value ?? "").trim();
    if (a1 !== "学年") {
      if (ws.name !== "使い方") skippedSheets.push(ws.name);
      return;
    }
    const grade = String(ws.getCell(1, 2).value ?? "").trim();
    const subject = String(ws.getCell(1, 4).value ?? "").trim();
    if (!grade || !subject) {
      skippedSheets.push(ws.name);
      return;
    }

    const planId = `${grade}|||${subject}`;
    const existing = existingById.get(planId);
    const existingUnitsByName = new Map<string, TeachingUnit>(
      (existing?.units ?? []).map((u) => [u.name, u])
    );

    // 行を順に読む（空行 = 内容・単元名・メモすべて空 は終端まで読み飛ばし）
    const units: TeachingUnit[] = [];
    const lessons: LessonPlanEntry[] = [];
    const usedUnitIds = new Set<string>();
    let currentUnit: TeachingUnit | null = null;
    let unitPeriodCounter = 0;

    for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const unitName = String(row.getCell(COLS.unit).value ?? "").trim();
      const rawContent = row.getCell(COLS.content).value;
      const content = (typeof rawContent === "object" && rawContent !== null && "richText" in rawContent
        ? (rawContent as { richText: { text: string }[] }).richText.map((t) => t.text).join("")
        : String(rawContent ?? "")
      ).trim();
      const notes = String(row.getCell(COLS.notes).value ?? "").trim();
      if (!unitName && !content && !notes) continue; // 完全な空行はスキップ

      // 単元の決定（連続する同名行は同じ単元）
      if (!unitName) {
        currentUnit = null;
        unitPeriodCounter = 0;
      } else if (!currentUnit || currentUnit.name !== unitName) {
        // 同名の単元が既にこのシート内で出ていたら（飛び地）新しい単元として扱わず再利用
        const sameInSheet = units.find((u) => u.name === unitName);
        if (sameInSheet) {
          currentUnit = sameInSheet;
          unitPeriodCounter = lessons.filter((l) => l.unitId === sameInSheet.id).length;
        } else {
          const ex = existingUnitsByName.get(unitName);
          const unit: TeachingUnit = {
            id: ex && !usedUnitIds.has(ex.id) ? ex.id : genId(),
            name: unitName,
            plannedPeriods: 0,
            ...(ex?.color ? { color: ex.color } : {}),
            ...(ex?.notes ? { notes: ex.notes } : {}),
            ...(ex?.lessons ? { lessons: ex.lessons } : {}),
          };
          usedUnitIds.add(unit.id);
          units.push(unit);
          currentUnit = unit;
          unitPeriodCounter = 0;
        }
      }
      if (currentUnit) unitPeriodCounter += 1;

      // 行位置が同じ既存コマのID・クラス別オーバーライドを温存
      const prev = existing?.lessons[lessons.length];
      lessons.push({
        id: prev?.id ?? genId(),
        unitId: currentUnit?.id ?? "",
        unitPeriod: currentUnit ? unitPeriodCounter : lessons.length + 1,
        content,
        ...(notes ? { notes } : {}),
        ...(prev?.classOverrides ? { classOverrides: prev.classOverrides } : {}),
      });
    }

    // plannedPeriods を実コマ数で更新
    for (const u of units) {
      u.plannedPeriods = lessons.filter((l) => l.unitId === u.id).length || u.plannedPeriods;
    }

    plans.push({ id: planId, grade, subject, units, lessons });
  });

  return { plans, skippedSheets };
}
