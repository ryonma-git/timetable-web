// icsExport.ts
// ICS (iCalendar) 形式でのエクスポートロジック
// Googleカレンダー等への取り込みに対応

import { TimetableEntry } from "./timetable";
import { SemesterMeta } from "./timetableFile";

// ICS日時フォーマット（UTC）: YYYYMMDDTHHMMSSZ
function toICSDateTimeUTC(dateStr: string, timeStr: string): string {
  // dateStr: YYYY-MM-DD, timeStr: HH:MM
  // JST（UTC+9）として扱い、UTCに変換
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const jst = new Date(y, mo - 1, d, h, mi, 0);
  const utc = new Date(jst.getTime() - 9 * 60 * 60 * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${utc.getFullYear()}${pad(utc.getMonth() + 1)}${pad(utc.getDate())}T${pad(utc.getHours())}${pad(utc.getMinutes())}00Z`;
}

// ICS日付フォーマット（終日イベント用）: YYYYMMDD
function toICSDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

// UIDを生成
function generateUID(dateStr: string, period: number, className: string): string {
  return `timetable-${dateStr}-p${period}-${className.replace(/\s/g, "_")}@timetable-app`;
}

// ICS文字列のエスケープ
function escapeICS(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// 長い行を折り返す（RFC 5545: 75オクテット以内）
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const result: string[] = [];
  let pos = 0;
  let first = true;
  while (pos < line.length) {
    const prefix = first ? "" : " ";
    const available = first ? 75 : 74;
    // 文字単位で切り出し（マルチバイト考慮）
    let chunk = "";
    let byteCount = 0;
    for (const char of line.slice(pos)) {
      const charBytes = new TextEncoder().encode(char).length;
      if (byteCount + charBytes > available) break;
      chunk += char;
      byteCount += charBytes;
    }
    result.push(prefix + chunk);
    pos += chunk.length;
    first = false;
  }
  return result.join("\r\n");
}

export interface ICSExportOptions {
  entries: TimetableEntry[];
  semester: SemesterMeta;
  title: string;
  school?: string;
  /** 時程表が設定されていない場合のデフォルト時刻（終日イベントとして出力） */
  fallbackToAllDay?: boolean;
}

export function exportToICS(options: ICSExportOptions): string {
  const { entries, semester, title, school, fallbackToAllDay = true } = options;
  const periodTimes = semester.periodTimes;
  const hasTimes = periodTimes && Object.keys(periodTimes).length > 0;

  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Timetable Manager//JP`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICS(title)}`,
    `X-WR-TIMEZONE:Asia/Tokyo`,
  ];

  for (const entry of entries) {
    for (const period of entry.periods) {
      if (!period.class && !period.subject) continue;

      const dateStr = entry.date;
      const periodNum = period.period;
      const className = period.class ?? "";
      const subjectName = period.subject ?? "";

      // イベントのサマリー（タイトル）
      let summary = "";
      if (subjectName && className) {
        summary = `${subjectName}（${className}）`;
      } else if (subjectName) {
        summary = subjectName;
      } else {
        summary = className;
      }
      if (school) summary = `[${school}] ${summary}`;

      // 説明文
      const descParts: string[] = [];
      if (period.reason) descParts.push(`備考: ${period.reason}`);
      descParts.push(`${periodNum}限`);
      const description = descParts.join("\\n");

      const uid = generateUID(dateStr, periodNum, `${className}-${subjectName}`);

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtstamp}`);

      if (hasTimes && periodTimes![periodNum]) {
        const { start, end } = periodTimes![periodNum];
        lines.push(`DTSTART:${toICSDateTimeUTC(dateStr, start)}`);
        lines.push(`DTEND:${toICSDateTimeUTC(dateStr, end)}`);
      } else if (fallbackToAllDay) {
        // 終日イベント
        lines.push(`DTSTART;VALUE=DATE:${toICSDate(dateStr)}`);
        // 翌日（ICSの終日は翌日の0時まで）
        const d = new Date(dateStr + "T00:00:00");
        d.setDate(d.getDate() + 1);
        const nextDay = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        lines.push(`DTEND;VALUE=DATE:${nextDay}`);
      } else {
        continue; // 時刻なし・終日なし → スキップ
      }

      lines.push(foldLine(`SUMMARY:${escapeICS(summary)}`));
      if (description) {
        lines.push(foldLine(`DESCRIPTION:${description}`));
      }
      lines.push(`CATEGORIES:時間割`);
      lines.push("END:VEVENT");
    }
  }

  lines.push("END:VCALENDAR");

  // ICSはCRLF改行
  return lines.join("\r\n") + "\r\n";
}

export function downloadICS(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
