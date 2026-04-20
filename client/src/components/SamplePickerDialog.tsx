// SamplePickerDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// サンプルデータ選択ダイアログ（3種類のモードのデモデータを提供）
// 通年度サンプル：年度のみ現在年に置き換え、今日の属する学期に自動ジャンプ

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpen, Music, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTimetable } from "@/contexts/TimetableContext";
import { deserializeTimetableFile } from "@/lib/timetableFile";
import type { TimetableFile } from "@/lib/timetableFile";

interface SampleDef {
  id: string;
  title: string;
  description: string;
  mode: string;
  modeLabel: string;
  modeColor: string;
  icon: React.ReactNode;
  filename: string;
  details: string[];
}

// 現在の年度を取得（4月以降なら当年、1〜3月なら前年）
function getCurrentFiscalYear(): number {
  const today = new Date();
  return today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
}

// 今日が属する学期の開始日を返す（第1:4〜7月、第2:9〜12月、第3:1〜3月）
function getCurrentSemesterStart(fiscalYear: number): string {
  const today = new Date();
  const m = today.getMonth() + 1; // 1-indexed
  if (m >= 4 && m <= 7) return `${fiscalYear}-04-07`;
  if (m >= 9 && m <= 12) return `${fiscalYear}-09-01`;
  // 1〜3月は第3学期（翌年）
  return `${fiscalYear + 1}-01-08`;
}

const SAMPLES: SampleDef[] = [
  {
    id: "homeroom",
    title: "担任サンプル（4年1組）",
    description: "担任モードのデモデータです。1年間の時間割が入っています。",
    mode: "homeroom",
    modeLabel: "担任モード",
    modeColor: "bg-amber-500/15 text-amber-600 border-amber-200",
    icon: <BookOpen size={20} className="text-amber-500" />,
    filename: "/samples/sample_homeroom.timetable",
    details: [
      "担任クラス: 4年1組",
      "教科: 国語・算数・理科・社会・道徳・体育・図工・音楽・外国語",
      "期間: 通年（第1〜3学期）",
      "読み込み後、今日の学期に自動ジャンプします",
    ],
  },
  {
    id: "single",
    title: "理科専科サンプル",
    description: "単一教科モードのデモデータです。4〜6年生の理科を担当する専科教員の例です。",
    mode: "single_subject",
    modeLabel: "単一教科モード",
    modeColor: "bg-blue-500/15 text-blue-600 border-blue-200",
    icon: <FlaskConical size={20} className="text-blue-500" />,
    filename: "/samples/sample_single.timetable",
    details: [
      "担当クラス: 4〜6年生 10クラス",
      "教科: 理科",
      "期間: 通年（第1〜3学期）",
      "読み込み後、今日の学期に自動ジャンプします",
    ],
  },
  {
    id: "multi",
    title: "複数教科サンプル（音楽・家庭科）",
    description: "複数教科モードのデモデータです。音楽（3・4年）と家庭科（5・6年）を担当する専科教員の例です。",
    mode: "multi_subject",
    modeLabel: "複数教科モード",
    modeColor: "bg-purple-500/15 text-purple-600 border-purple-200",
    icon: <Music size={20} className="text-purple-500" />,
    filename: "/samples/sample_multi.timetable",
    details: [
      "担当クラス: 3ー6年生 8クラス",
      "教科: 音楽（3・4年）・家庭科（5・6年）",
      "期間: 通年（第1ー3学期）",
      "読み込み後、今日の学期に自動ジャンプします",
    ],
  },
  {
    id: "ab_week",
    title: "A週・B週サンプル（理科専科）",
    description: "A週・B週の2週ローテーションのデモデータです。週ごとに授業クラスが切り替わる時間割の例です。",
    mode: "single_subject",
    modeLabel: "単一教科モード",
    modeColor: "bg-green-500/15 text-green-600 border-green-200",
    icon: <RefreshCw size={20} className="text-green-500" />,
    filename: "/samples/sample_ab.timetable",
    details: [
      "担当クラス: 4ー6年生 12クラス",
      "教科: 理科",
      "A週: 月・水・金中心の授業パターン",
      "B週: 火・木中心の授業パターン",
      "週ヘッダーのA週/B週バッジをタップして手動変更も可能",
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SamplePickerDialog({ open, onClose }: Props) {
  const { loadTimetableFile, goToDate } = useTimetable();
  const [loading, setLoading] = useState<string | null>(null);

  const handleLoad = async (sample: SampleDef) => {
    setLoading(sample.id);
    try {
      const res = await fetch(sample.filename, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const result = deserializeTimetableFile(text);

      // 年度のみ現在年度に置き換え（日付はそのまま、年だけ差し替え）
      const fiscalYear = getCurrentFiscalYear();
      const file = shiftFiscalYear(result.file, fiscalYear);

      await loadTimetableFile(file);
      result.warnings.forEach(w => toast.warning(w));

      // 今日が属する学期の開始日にジャンプ
      const jumpDate = getCurrentSemesterStart(fiscalYear);
      goToDate(new Date(jumpDate + "T00:00:00"));

      toast.success(`サンプル読み込み完了: ${sample.title}`);
      onClose();
    } catch (err) {
      toast.error(`読み込みエラー: ${String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>サンプルデータを選択</DialogTitle>
          <DialogDescription className="text-xs">
            デモ用の通年サンプルデータを読み込めます。年度は現在の年度（{getCurrentFiscalYear()}年度）に自動調整されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 overflow-y-auto flex-1 min-h-0">
          {SAMPLES.map(sample => (
            <div
              key={sample.id}
              className="border border-border rounded-lg p-4 hover:border-primary/40 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{sample.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="text-sm font-semibold">{sample.title}</h3>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${sample.modeColor}`}>
                      {sample.modeLabel}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{sample.description}</p>
                  <ul className="space-y-0.5">
                    {sample.details.map((d, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                        <span className="text-muted-foreground/40 mt-0.5 shrink-0">·</span>
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleLoad(sample)}
                  disabled={loading !== null}
                  className="shrink-0 h-8 text-xs"
                >
                  {loading === sample.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    "読み込む"
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * サンプルファイルの年度を指定の年度に置き換える。
 * 日付の月日はそのまま、年のみを差し替える。
 * 第1・2学期は fiscalYear 年、第3学期は fiscalYear+1 年になる。
 */
function shiftFiscalYear(file: TimetableFile, fiscalYear: number): TimetableFile {
  const sem = file.semester;
  if (!sem?.startDate) return file;

  // サンプルの年度を検出（startDateの年が4〜12月なら第1/2学期、1〜3月なら第3学期）
  const sampleStartYear = parseInt(sem.startDate.slice(0, 4), 10);
  const sampleStartMonth = parseInt(sem.startDate.slice(5, 7), 10);
  const sampleFiscalYear = sampleStartMonth >= 4 ? sampleStartYear : sampleStartYear - 1;

  if (sampleFiscalYear === fiscalYear) return file; // 既に同じ年度

  const yearDiff = fiscalYear - sampleFiscalYear;

  const shiftDate = (dateStr: string): string => {
    const year = parseInt(dateStr.slice(0, 4), 10);
    return `${year + yearDiff}${dateStr.slice(4)}`;
  };

  const newBase = file.base.map(entry => ({
    ...entry,
    date: shiftDate(entry.date),
  }));

  const newOps = (file.ops ?? []).map(op => ({
    ...op,
    date: shiftDate(op.date),
  }));

  const newSemester = {
    ...sem,
    startDate: shiftDate(sem.startDate),
    endDate: shiftDate(sem.endDate),
    holidays: (sem.holidays ?? []).map((h: { date: string; name?: string }) => ({
      ...h,
      date: shiftDate(h.date),
    })),
  };

  const newMeta = {
    ...file.meta,
    year: `${fiscalYear}年度`,
  };

  return {
    ...file,
    meta: newMeta,
    semester: newSemester,
    base: newBase,
    ops: newOps,
  };
}
