// PatchImportDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// 部分インポート（timetable-patch/v1）ダイアログ
// ドラッグ＆ドロップ対応、partial / full_replace の2モード

import { useState, useCallback, useRef, useEffect } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Upload, FileJson, AlertTriangle, CheckCircle2, X, Info, Download, BookOpen } from "lucide-react";
import { toast } from "sonner";
import type { OverrideOp } from "@/lib/timetable";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/contexts/LanguageContext";

function wf(t: (k: TranslationKey) => string, key: TranslationKey, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// ─── Patch Format ─────────────────────────────────────────────

interface TimetablePatch {
  format: "timetable-patch/v1";
  mode: "partial" | "full_replace";
  description?: string;
  notes?: string;
  dateRange?: { start: string; end: string };
  ops: OverrideOp[];
}

interface ParseResult {
  patch: TimetablePatch;
  warnings: string[];
  opsCount: number;
  affectedDates: string[];
}

// ─── Parser ───────────────────────────────────────────────────

function parsePatchFile(json: string, t: (k: TranslationKey) => string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(t("patch.errInvalidJson"));
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.format !== "timetable-patch/v1") {
    throw new Error(wf(t, "patch.errBadFormat", { fmt: String(obj.format) }));
  }

  if (obj.mode !== "partial" && obj.mode !== "full_replace") {
    throw new Error(wf(t, "patch.errBadMode", { mode: String(obj.mode) }));
  }

  if (!Array.isArray(obj.ops) || obj.ops.length === 0) {
    throw new Error(t("patch.errOpsEmpty"));
  }

  const warnings: string[] = [];
  const validOps: OverrideOp[] = [];
  const dateSet = new Set<string>();

  for (let i = 0; i < (obj.ops as unknown[]).length; i++) {
    const op = (obj.ops as Record<string, unknown>[])[i];
    if (!op.op || !op.date) {
      warnings.push(wf(t, "patch.errNoOpField", { i }));
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(op.date as string)) {
      warnings.push(wf(t, "patch.errBadDate", { i, date: String(op.date) }));
      continue;
    }
    dateSet.add(op.date as string);
    validOps.push(op as unknown as OverrideOp);
  }

  if (validOps.length === 0) {
    throw new Error(t("patch.errNoValidOps"));
  }

  const affectedDates = Array.from(dateSet).sort();

  return {
    patch: { ...(obj as unknown as TimetablePatch), ops: validOps },
    warnings,
    opsCount: validOps.length,
    affectedDates,
  };
}

// ─── Template Data ───────────────────────────────────────────

const PARTIAL_TEMPLATE = {
  format: "timetable-patch/v1",
  mode: "partial",
  description: "運動会練習期間 特別時間割（部分書き換えの例）",
  notes: "このファイルはLLMなどで生成したパッチをインポートするためのテンプレートです。\n実際のクラス名・日付に合わせて編集してください。",
  dateRange: { start: "2024-09-09", end: "2024-09-20" },
  ops: [
    { op: "set_period_class", date: "2024-09-09", period: 1, class: "1年1組", subject: "体育", reason: "運動会練習" },
    { op: "set_period_class", date: "2024-09-09", period: 2, class: "2年1組", subject: "体育", reason: "運動会練習" },
    { op: "set_period_class", date: "2024-09-10", period: 1, class: "3年1組", subject: "体育", reason: "運動会練習" },
    { op: "clear_period_class", date: "2024-09-10", period: 3 },
    { op: "set_period_reason", date: "2024-09-11", period: 2, reason: "運動会全体練習（授業なし）" }
  ]
};

const FULL_REPLACE_TEMPLATE = {
  format: "timetable-patch/v1",
  mode: "full_replace",
  description: "運動会練習期間 特別時間割（全書き換えの例）",
  notes: "full_replaceモードでは、dateRange内の全コマがクリアされてからopsが適用されます。",
  dateRange: { start: "2024-09-09", end: "2024-09-13" },
  ops: [
    { op: "set_period_class", date: "2024-09-09", period: 1, class: "1年1組", subject: "体育", reason: "運動会練習" },
    { op: "set_period_class", date: "2024-09-09", period: 2, class: "2年1組", subject: "体育", reason: "運動会練習" },
    { op: "set_period_class", date: "2024-09-10", period: 1, class: "3年1組", subject: "体育", reason: "運動会練習" }
  ]
};

const PARTIAL_TEMPLATE_JSON = JSON.stringify(PARTIAL_TEMPLATE, null, 2);
const FULL_REPLACE_TEMPLATE_JSON = JSON.stringify(FULL_REPLACE_TEMPLATE, null, 2);

const README_IMPORT_MD = `# timetable-patch/v1 インポート形式 仕様書

## 概要

\`timetable-patch/v1\` 形式のJSONファイルを使うと、時間割の一部または全体を外部から書き換えることができます。
LLM（ChatGPT・Claude等）にこの仕様書とテンプレートを渡して、特別時間割のJSONを生成させることができます。

---

## ファイル構造

\`\`\`json
{
  "format": "timetable-patch/v1",
  "mode": "partial" または "full_replace",
  "description": "説明文（省略可）",
  "notes": "備考（省略可）",
  "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "ops": [ ... ]
}
\`\`\`

---

## mode の違い

| mode | 動作 |
|------|------|
| \`partial\` | opsで指定したコマのみ上書き。他のコマは変更しない |
| \`full_replace\` | dateRange内の全コマをクリアしてからopsを適用 |

---

## ops の種類

| op | 必須フィールド | 動作 |
|----|--------------|------|
| \`set_period_class\` | date, period, class | 指定コマにクラスを割り当て（subjectで教科名も指定可） |
| \`clear_period_class\` | date, period | 指定コマを空きコマに |
| \`set_period_reason\` | date, period, reason | 指定コマに備考のみ設定 |
| \`set_day_reason\` | date, reason | 指定日に日付レベルの備考 |

---

## フィールド説明

- \`date\`: 日付（YYYY-MM-DD形式、例: "2024-09-09"）
- \`period\`: 時限番号（1〜6の整数）
- \`class\`: クラス名（例: "1年1組", "3年2組"）または \`null\`（空きコマ）
- \`subject\`: 教科名（例: "理科", "体育"）。省略可。指定した場合、教科ビューでその教科名と教科カラーが表示されます
- \`reason\`: 備考テキスト（省略可）

---

## LLMへのプロンプト例

以下のプロンプトをChatGPT・Claude等に貼り付けて使用してください：

---

以下の仕様に従って、timetable-patch/v1形式のJSONを生成してください。

【仕様】
- format: "timetable-patch/v1" （固定）
- mode: "partial"（一部変更）または "full_replace"（期間全体を書き換え）
- ops の op には set_period_class / clear_period_class / set_period_reason のいずれかを使用
- date は YYYY-MM-DD 形式
- period は 1〜6 の整数

【生成したい時間割の内容】
（ここに具体的な内容を記述してください）
例：9月9日〜9月20日の運動会練習期間中、月・水・金の1〜3時限を以下のように変更してください。
- 1時限: 1年1組
- 2時限: 2年1組
- 3時限: 3年1組

---

## 注意事項

- インポート後は「変更履歴」タブから取り消しが可能です
- full_replaceモードは元に戻す際も変更履歴から行ってください
- クラス名は時間割アプリに登録されているクラス名と完全一致させてください
`;

function downloadText(filename: string, content: string, mimeType = "application/json") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PatchImportDialog({ open, onClose }: Props) {
  const { applyOps } = useTimetable();
  const { t, language } = useLanguage();
  const [isDragging, setIsDragging] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setParseResult(null);
      setParseError(null);
      setIsApplying(false);
    }
  }, [open]);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".json")) {
      setParseError(t("patch.jsonOnlyError"));
      setParseResult(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = parsePatchFile(e.target?.result as string, t);
        setParseResult(result);
        setParseError(null);
      } catch (err) {
        setParseError((err as Error).message);
        setParseResult(null);
      }
    };
    reader.readAsText(file, "utf-8");
  }, [t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleApply = async () => {
    if (!parseResult) return;
    setIsApplying(true);
    try {
      const desc = parseResult.patch.description
        ?? `パッチインポート (${parseResult.patch.mode === "full_replace" ? "全書き換え" : "部分書き換え"}) ${parseResult.affectedDates[0]}〜${parseResult.affectedDates[parseResult.affectedDates.length - 1]}`;

      // full_replace: dateRange内の全コマをクリアするopsを先頭に挿入
      let opsToApply = [...parseResult.patch.ops];
      if (parseResult.patch.mode === "full_replace" && parseResult.patch.dateRange) {
        const { start, end } = parseResult.patch.dateRange;
        const clearOps: OverrideOp[] = [];
        const startD = new Date(start + "T00:00:00");
        const endD = new Date(end + "T00:00:00");
        for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          for (let p = 1; p <= 6; p++) {
            clearOps.push({ op: "clear_period_class", date: dateStr, period: p, clear_all_classes: true });
          }
        }
        opsToApply = [...clearOps, ...parseResult.patch.ops];
      }

      applyOps(opsToApply, desc);
      toast.success(
        wf(t, "patch.toastDone", { n: parseResult.opsCount }),
        { description: parseResult.patch.description ?? undefined }
      );
      onClose();
    } catch (err) {
      toast.error(t("patch.toastError"), { description: (err as Error).message });
    } finally {
      setIsApplying(false);
    }
  };

  const modeLabel = parseResult?.patch.mode === "full_replace" ? t("patch.modeFull") : t("patch.modePartial");
  const modeColor = parseResult?.patch.mode === "full_replace" ? "text-red-600" : "text-blue-600";
  const modeBg = parseResult?.patch.mode === "full_replace" ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200";

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg w-[95vw] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Upload size={16} />
            {t("patch.dialogTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* Download templates section */}
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <p className="text-xs text-muted-foreground mb-2 font-medium">{t("patch.templateSection")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 gap-1.5"
              onClick={() => downloadText("partial_import_template.json", PARTIAL_TEMPLATE_JSON)}
            >
              <Download size={11} />
              {t("patch.downloadPartial")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 gap-1.5"
              onClick={() => downloadText("full_replace_import_template.json", FULL_REPLACE_TEMPLATE_JSON)}
            >
              <Download size={11} />
              {t("patch.downloadFull")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 gap-1.5"
              onClick={() => downloadText("README_import.md", README_IMPORT_MD, "text/markdown")}
            >
              <BookOpen size={11} />
              {t("patch.downloadReadme")}
            </Button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : parseResult
                ? "border-green-400 bg-green-50"
                : parseError
                ? "border-red-400 bg-red-50"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileInput}
            />
            {parseResult ? (
              <div className="flex flex-col items-center gap-2">
                <CheckCircle2 size={28} className="text-green-500" />
                <p className="text-sm font-medium text-green-700">{t("patch.dropSuccess")}</p>
                <p className="text-xs text-muted-foreground">{t("patch.dropClick")}</p>
              </div>
            ) : parseError ? (
              <div className="flex flex-col items-center gap-2">
                <AlertTriangle size={28} className="text-red-500" />
                <p className="text-sm font-medium text-red-700">{t("patch.dropError")}</p>
                <p className="text-xs text-muted-foreground">{t("patch.dropClick")}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FileJson size={28} className="text-muted-foreground" />
                <p className="text-sm font-medium">{t("patch.dropZone")}</p>
                <p className="text-xs text-muted-foreground">{t("patch.dropOr")}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">{t("patch.dropNote")}</p>
              </div>
            )}
          </div>

          {/* Error */}
          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Parse result preview */}
          {parseResult && (
            <div className="space-y-3">
              {/* Mode badge */}
              <div className={cn("flex items-center gap-2 p-3 rounded-lg border text-sm", modeBg)}>
                <Info size={14} className={cn("shrink-0", modeColor)} />
                <div>
                  <span className={cn("font-bold", modeColor)}>{wf(t, "patch.modeLabel", { mode: modeLabel })}</span>
                  {parseResult.patch.mode === "full_replace" && (
                    <p className="text-xs text-red-600 mt-0.5">
                      {t("patch.fullReplaceWarning")}
                    </p>
                  )}
                </div>
              </div>

              {/* Summary */}
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2 text-sm">
                {parseResult.patch.description && (
                  <p className="font-medium">{parseResult.patch.description}</p>
                )}
                {parseResult.patch.notes && (
                  <p className="text-xs text-muted-foreground">{parseResult.patch.notes}</p>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
                  <span className="text-muted-foreground">{t("patch.opsCount")}</span>
                  <span className="font-medium">{parseResult.opsCount}{language === "ja" ? " 件" : ""}</span>
                  <span className="text-muted-foreground">{t("patch.affectedDays")}</span>
                  <span className="font-medium">{parseResult.affectedDates.length}{language === "ja" ? " 日" : ""}</span>
                  {parseResult.patch.dateRange && (
                    <>
                      <span className="text-muted-foreground">{t("patch.dateRange")}</span>
                      <span className="font-medium">
                        {parseResult.patch.dateRange.start} 〜 {parseResult.patch.dateRange.end}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">{t("patch.firstDate")}</span>
                  <span className="font-medium">{parseResult.affectedDates[0]}</span>
                  <span className="text-muted-foreground">{t("patch.lastDate")}</span>
                  <span className="font-medium">{parseResult.affectedDates[parseResult.affectedDates.length - 1]}</span>
                </div>
              </div>

              {/* Warnings */}
              {parseResult.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                  <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                    <AlertTriangle size={12} />
                    {wf(t, "patch.warningCount", { n: parseResult.warnings.length })}
                  </p>
                  {parseResult.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-600 pl-4">{w}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={onClose} className="gap-1.5">
            <X size={13} />
            {t("wiz.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={!parseResult || isApplying}
            className={cn(
              "gap-1.5 min-w-[120px]",
              parseResult?.patch.mode === "full_replace" && "bg-red-600 hover:bg-red-700"
            )}
          >
            {isApplying ? (
              t("patch.applyingBtn")
            ) : (
              <>
                <Upload size={13} />
                {parseResult?.patch.mode === "full_replace" ? t("patch.applyFull") : t("patch.applyPartial")}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
