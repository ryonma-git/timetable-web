// SamplePickerDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// サンプルデータ選択ダイアログ（3種類のモードのデモデータを提供）

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpen, Music, FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTimetable } from "@/contexts/TimetableContext";
import { deserializeTimetableFile } from "@/lib/timetableFile";

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

const SAMPLES: SampleDef[] = [
  {
    id: "homeroom",
    title: "2年1組 第3学期 時間割",
    description: "担任モードのデモデータです。",
    mode: "homeroom",
    modeLabel: "担任モード",
    modeColor: "bg-amber-500/15 text-amber-600 border-amber-200",
    icon: <BookOpen size={20} className="text-amber-500" />,
    filename: "/samples/sample_homeroom.timetable",
    details: [
      "担任クラス: 2年1組",
      "教科: 国語・算数・生活・音楽・図工・体育・道徳・学活",
      "期間: 2026年1月8日〜3月24日（第3学期）",
      "授業変更操作: 6件（体育入れ替え・図工追加など）",
    ],
  },
  {
    id: "single",
    title: "理科専科 3学期 時間割",
    description: "単一教科モードのデモデータです。実際の理科専科の時間割データです。",
    mode: "single_subject",
    modeLabel: "単一教科モード",
    modeColor: "bg-blue-500/15 text-blue-600 border-blue-200",
    icon: <FlaskConical size={20} className="text-blue-500" />,
    filename: "/samples/sample_single.timetable",
    details: [
      "担当クラス: 4〜6年生 10クラス（4年3・5年4・6年3）",
      "教科: 理科",
      "期間: 2026年1月8日〜3月27日（第3学期）",
      "授業変更操作: 28件（振替・時間割変更・行事など）",
    ],
  },
  {
    id: "multi",
    title: "音楽・体育専科 3学期 時間割",
    description: "複数教科モードのデモデータです。音楽と体育の2教科を担当する専科教員の例です。",
    mode: "multi_subject",
    modeLabel: "複数教科モード",
    modeColor: "bg-purple-500/15 text-purple-600 border-purple-200",
    icon: <Music size={20} className="text-purple-500" />,
    filename: "/samples/sample_multi.timetable",
    details: [
      "担当クラス: 4〜6年生 8クラス（4年3・5年3・6年2）",
      "教科: 音楽（4・6年担当）・体育（5年担当）",
      "期間: 2026年1月8日〜3月27日（第3学期）",
      "授業変更操作: 12件（振替・行事・卒業式練習など）",
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
      const res = await fetch(sample.filename);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const result = deserializeTimetableFile(text);
      await loadTimetableFile(result.file);
      result.warnings.forEach(w => toast.warning(w));
      // 学期開始週に移動
      const startDate = result.file.semester?.startDate;
      if (startDate) {
        goToDate(new Date(startDate + "T00:00:00"));
      }
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>サンプルデータを選択</DialogTitle>
          <DialogDescription className="text-xs">
            デモ用のサンプルデータを読み込んで、アプリの機能を試すことができます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
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
