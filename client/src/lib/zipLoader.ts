// zipLoader.ts
// ブラウザ上でZIPファイルを解析してtimetableデータを読み込む

import JSZip from "jszip";
import type { EffectiveBundle, OverrideBundle, TimetableEntry } from "./timetable";

export interface LoadResult {
  base: TimetableEntry[];
  effective: TimetableEntry[];
  overrideBundle?: OverrideBundle;
  warnings: string[];
  loadedFiles: string[];
}

export async function loadZIPFile(file: File): Promise<LoadResult> {
  const zip = await JSZip.loadAsync(file);

  const result: LoadResult = {
    base: [],
    effective: [],
    warnings: [],
    loadedFiles: [],
  };

  const files = Object.entries(zip.files as Record<string, any>);

  for (const [name, zipEntry] of files) {
    if (zipEntry.dir) continue;
    const basename = name.split("/").pop() ?? name;
    result.loadedFiles.push(basename);

    if (!basename.endsWith(".json")) continue;

    try {
      const text = await zipEntry.async("text");
      const json = JSON.parse(text);

      if (basename.includes("effective") && basename.includes("by_date_and_weekday")) {
        // effective JSON
        const bundle = json as EffectiveBundle;
        if (bundle.by_date) {
          result.effective = normalizeEntries(bundle.by_date);
          if (result.base.length === 0) result.base = result.effective;
        }
      } else if (basename.includes("REGENERATED") && basename.includes("by_date_and_weekday")) {
        // base (REGENERATED) JSON
        const bundle = json as EffectiveBundle;
        if (bundle.by_date) {
          result.base = normalizeEntries(bundle.by_date);
        }
      } else if (basename.includes("override")) {
        // override JSON
        result.overrideBundle = json as OverrideBundle;
      }
    } catch (e) {
      result.warnings.push(`JSONパースエラー [${basename}]: ${String(e)}`);
    }
  }

  // base が空の場合は effective を使用
  if (result.base.length === 0 && result.effective.length > 0) {
    result.base = result.effective;
  }

  return result;
}

function normalizeEntries(entries: any[]): TimetableEntry[] {
  return entries.map(e => ({
    date: e.date ?? "",
    weekday: e.weekday ?? "",
    weekday_jp: e.weekday_jp ?? e.weekdayJP ?? "",
    periods: (e.periods ?? []).map((p: any) => ({
      period: p.period,
      class: p.class ?? null,
      reason: p.reason ?? undefined,
    })),
  }));
}
