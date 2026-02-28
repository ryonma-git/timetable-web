// llmImport.ts
// LLM連携機能: 画像からの時間割・時程表読み取り支援
// JSONテンプレート生成・LLM向けプロンプト生成・ファイルダウンロード

import { SemesterMeta } from "./timetableFile";

// ─── 時間割JSONテンプレート ──────────────────────────────────────

export interface TimetableImportTemplate {
  _description: string;
  _instructions: string;
  weekdays: {
    Mon: Record<number, string | null>;
    Tue: Record<number, string | null>;
    Wed: Record<number, string | null>;
    Thu: Record<number, string | null>;
    Fri: Record<number, string | null>;
    Sat?: Record<number, string | null>;
    Sun?: Record<number, string | null>;
  };
}

export function generateTimetableTemplate(semester: SemesterMeta): TimetableImportTemplate {
  const periods = [1, 2, 3, 4, 5, 6];
  const makeDay = (): Record<number, string | null> => {
    const d: Record<number, string | null> = {};
    periods.forEach(p => { d[p] = null; });
    return d;
  };

  const template: TimetableImportTemplate = {
    _description: "時間割インポート用JSONテンプレート（Timetable Manager）",
    _instructions: [
      "各コマに授業クラス名（例: '1年1組'）または教科名（例: '国語'）を入力してください。",
      "授業なしのコマはnullのままにしてください。",
      "このファイルをLLMに渡して画像から自動入力することもできます。",
      `利用可能なクラス: ${semester.classList?.join(", ") ?? "（クラスリストなし）"}`,
    ].join(" / "),
    weekdays: {
      Mon: makeDay(),
      Tue: makeDay(),
      Wed: makeDay(),
      Thu: makeDay(),
      Fri: makeDay(),
    },
  };

  if (semester.hasSaturday) template.weekdays.Sat = makeDay();
  if (semester.hasSunday) template.weekdays.Sun = makeDay();

  return template;
}

// ─── 時程表JSONテンプレート ──────────────────────────────────────

export interface PeriodTimesImportTemplate {
  _description: string;
  _instructions: string;
  mode: "shared" | "by_day";
  shared: Record<number, { start: string; end: string }>;
  by_day?: {
    Mon?: Record<number, { start: string; end: string }>;
    Tue?: Record<number, { start: string; end: string }>;
    Wed?: Record<number, { start: string; end: string }>;
    Thu?: Record<number, { start: string; end: string }>;
    Fri?: Record<number, { start: string; end: string }>;
    Sat?: Record<number, { start: string; end: string }>;
    Sun?: Record<number, { start: string; end: string }>;
  };
}

export function generatePeriodTimesTemplate(semester: SemesterMeta): PeriodTimesImportTemplate {
  const periods = [1, 2, 3, 4, 5, 6];
  const makeShared = (): Record<number, { start: string; end: string }> => {
    const d: Record<number, { start: string; end: string }> = {};
    periods.forEach(p => { d[p] = { start: "HH:MM", end: "HH:MM" }; });
    return d;
  };

  return {
    _description: "時程表インポート用JSONテンプレート（Timetable Manager）",
    _instructions: [
      "shared: 全曜日共通の時程を入力してください（HH:MM形式、例: '08:50'）。",
      "曜日ごとに時程が異なる場合は mode を 'by_day' に変更し、by_day に各曜日の時程を入力してください。",
      "by_day に入力した曜日はその時程が優先されます。入力しない曜日は shared の時程が使われます。",
    ].join(" / "),
    mode: "shared",
    shared: makeShared(),
    by_day: {
      Mon: makeShared(),
      Tue: makeShared(),
      Wed: makeShared(),
      Thu: makeShared(),
      Fri: makeShared(),
    },
  };
}

// ─── LLM向けプロンプト生成 ──────────────────────────────────────

export function generateTimetablePrompt(semester: SemesterMeta): string {
  const classList = semester.classList?.join("、") ?? "（クラスリストなし）";
  return `あなたは学校の時間割を読み取るアシスタントです。
添付された時間割の画像を見て、以下のJSONテンプレートに情報を入力してください。

【入力ルール】
- 各コマ（period）に対応するクラス名を入力してください。
- 利用可能なクラス: ${classList}
- 授業がないコマはnullのままにしてください。
- 曜日キーは Mon（月）、Tue（火）、Wed（水）、Thu（木）、Fri（金）です。
- periodは1〜6の数字です（1限〜6限）。
- JSONの_descriptionと_instructionsフィールドはそのままにしてください。
- 読み取れない場合はnullにしてください。

【出力形式】
入力済みのJSONのみを出力してください。説明文は不要です。`;
}

export function generatePeriodTimesPrompt(): string {
  return `あなたは学校の時程表を読み取るアシスタントです。
添付された時程表の画像を見て、以下のJSONテンプレートに情報を入力してください。

【入力ルール】
- 各コマ（period）の開始時刻（start）と終了時刻（end）をHH:MM形式で入力してください。
  例: "08:50"、"09:35"
- 全曜日で時程が同じ場合は mode を "shared" のままにして、shared フィールドのみ入力してください。
- 曜日ごとに時程が異なる場合は mode を "by_day" に変更し、by_day の各曜日に入力してください。
- 読み取れない場合は "HH:MM" のままにしてください。

【出力形式】
入力済みのJSONのみを出力してください。説明文は不要です。`;
}

// ─── ファイルダウンロード ────────────────────────────────────────

export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
