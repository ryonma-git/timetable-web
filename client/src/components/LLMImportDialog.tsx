// Design: Swiss Grid × Japanese Functional Design
// LLMImportDialog: LLM連携による画像からの時間割・時程表読み取り支援ダイアログ

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bot, Download, Copy, Check, FileJson, Clock, ChevronRight } from "lucide-react";
import { useTimetable } from "@/contexts/TimetableContext";
import {
  generateTimetableTemplate,
  generatePeriodTimesTemplate,
  generateTimetablePrompt,
  generatePeriodTimesPrompt,
  downloadJSON,
  copyToClipboard,
} from "@/lib/llmImport";
import { cn } from "@/lib/utils";

export type LLMImportMode = "timetable" | "period_times";

interface LLMImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: LLMImportMode;
}

export function LLMImportDialog({ open, onOpenChange, mode = "timetable" }: LLMImportDialogProps) {
  const { semester } = useTimetable();
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [activeMode, setActiveMode] = useState<LLMImportMode>(mode);

  if (!semester) return null;

  const isTimetable = activeMode === "timetable";

  const handleDownloadTemplate = () => {
    if (isTimetable) {
      const template = generateTimetableTemplate(semester);
      downloadJSON(template, "timetable_template");
    } else {
      const template = generatePeriodTimesTemplate(semester);
      downloadJSON(template, "period_times_template");
    }
  };

  const handleCopyTemplate = async () => {
    let json: string;
    if (isTimetable) {
      json = JSON.stringify(generateTimetableTemplate(semester), null, 2);
    } else {
      json = JSON.stringify(generatePeriodTimesTemplate(semester), null, 2);
    }
    await copyToClipboard(json);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  const handleCopyPrompt = async () => {
    const prompt = isTimetable
      ? generateTimetablePrompt(semester)
      : generatePeriodTimesPrompt();
    await copyToClipboard(prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const steps = [
    {
      num: 1,
      title: "JSONテンプレートを取得",
      desc: "空のJSONテンプレートをダウンロードまたはコピーします。",
      action: (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleDownloadTemplate}>
            <Download size={12} />
            ダウンロード
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleCopyTemplate}>
            {copiedTemplate ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
            {copiedTemplate ? "コピー済み" : "コピー"}
          </Button>
        </div>
      ),
    },
    {
      num: 2,
      title: "LLM向けプロンプトをコピー",
      desc: "ChatGPT・Claude等に渡すプロンプトをコピーします。",
      action: (
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleCopyPrompt}>
          {copiedPrompt ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
          {copiedPrompt ? "コピー済み" : "プロンプトをコピー"}
        </Button>
      ),
    },
    {
      num: 3,
      title: "LLMに画像とテンプレートを渡す",
      desc: "ChatGPT・Claude等を開き、「プロンプト」「JSONテンプレート」「時間割の画像」を一緒に貼り付けて送信します。",
      action: null,
    },
    {
      num: 4,
      title: "LLMが返したJSONをインポート",
      desc: isTimetable
        ? "LLMが出力したJSONをコピーし、「インポート」ボタンからパッチインポートで読み込みます。"
        : "LLMが出力したJSONをコピーし、時程表設定ダイアログの「JSONから貼り付け」機能で読み込みます（今後対応予定）。",
      action: null,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot size={18} className="text-primary" />
            LLM連携で画像から読み取る
          </DialogTitle>
          <DialogDescription className="text-xs">
            ChatGPT・Claude等のLLMを使って、時間割や時程表の画像から自動でデータを入力できます。
          </DialogDescription>
        </DialogHeader>

        {/* モード切り替え */}
        <div className="flex gap-2 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setActiveMode("timetable")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all",
              activeMode === "timetable"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FileJson size={13} />
            時間割
          </button>
          <button
            onClick={() => setActiveMode("period_times")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all",
              activeMode === "period_times"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Clock size={13} />
            時程表
          </button>
        </div>

        {/* 手順 */}
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={step.num} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                  {step.num}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px flex-1 bg-border mt-1" />
                )}
              </div>
              <div className="pb-3 flex-1">
                <p className="text-sm font-medium mb-0.5">{step.title}</p>
                <p className="text-xs text-muted-foreground mb-2">{step.desc}</p>
                {step.action}
              </div>
            </div>
          ))}
        </div>

        {/* ヒント */}
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
            <ChevronRight size={12} className="mt-0.5 shrink-0" />
            <span>
              <strong>ヒント:</strong> GPT-4o・Claude 3.5 Sonnet等の画像対応モデルを使うと精度が上がります。
              読み取り結果は必ず確認してから保存してください。
            </span>
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
