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
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/contexts/LanguageContext";

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

function wf(t: (k: TranslationKey) => string, key: TranslationKey, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
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

function getSamples(t: (k: TranslationKey) => string): SampleDef[] {
  return [
    {
      id: "homeroom",
      title: t("sample.homeroom.title"),
      description: t("sample.homeroom.desc"),
      mode: "homeroom",
      modeLabel: t("sample.modeHomeroom"),
      modeColor: "bg-amber-500/15 text-amber-600 border-amber-200",
      icon: <BookOpen size={20} className="text-amber-500" />,
      filename: "/samples/sample_homeroom.timetable",
      details: [
        t("sample.homeroom.d1"),
        t("sample.homeroom.d2"),
        t("sample.sharedDuration"),
        t("sample.sharedAutoJump"),
      ],
    },
    {
      id: "single",
      title: t("sample.single.title"),
      description: t("sample.single.desc"),
      mode: "single_subject",
      modeLabel: t("sample.modeSingle"),
      modeColor: "bg-blue-500/15 text-blue-600 border-blue-200",
      icon: <FlaskConical size={20} className="text-blue-500" />,
      filename: "/samples/sample_single.timetable",
      details: [
        t("sample.single.d1"),
        t("sample.single.d2"),
        t("sample.sharedDuration"),
        t("sample.sharedAutoJump"),
      ],
    },
    {
      id: "multi",
      title: t("sample.multi.title"),
      description: t("sample.multi.desc"),
      mode: "multi_subject",
      modeLabel: t("sample.modeMulti"),
      modeColor: "bg-purple-500/15 text-purple-600 border-purple-200",
      icon: <Music size={20} className="text-purple-500" />,
      filename: "/samples/sample_multi.timetable",
      details: [
        t("sample.multi.d1"),
        t("sample.multi.d2"),
        t("sample.sharedDuration"),
        t("sample.sharedAutoJump"),
      ],
    },
    {
      id: "ab_week",
      title: t("sample.abWeek.title"),
      description: t("sample.abWeek.desc"),
      mode: "single_subject",
      modeLabel: t("sample.modeSingle"),
      modeColor: "bg-green-500/15 text-green-600 border-green-200",
      icon: <RefreshCw size={20} className="text-green-500" />,
      filename: "/samples/sample_ab.timetable",
      details: [
        t("sample.abWeek.d1"),
        t("sample.single.d2"),
        t("sample.abWeek.d2"),
        t("sample.abWeek.d3"),
        t("sample.abWeek.d4"),
      ],
    },
  ];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SamplePickerDialog({ open, onClose }: Props) {
  const { loadTimetableFile, goToDate } = useTimetable();
  const { t } = useLanguage();
  const [loading, setLoading] = useState<string | null>(null);
  const SAMPLES = getSamples(t);

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

      toast.success(wf(t, "sample.toastDone", { title: sample.title }));
      onClose();
    } catch (err) {
      toast.error(wf(t, "sample.toastError", { msg: String(err) }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("sample.dialogTitle")}</DialogTitle>
          <DialogDescription className="text-xs">
            {wf(t, "sample.dialogDesc", { y: getCurrentFiscalYear() })}
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
                    t("sample.load")
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("sample.close")}
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
