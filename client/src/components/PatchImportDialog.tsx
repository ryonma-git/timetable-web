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
import { Upload, FileJson, AlertTriangle, CheckCircle2, X, Info } from "lucide-react";
import { toast } from "sonner";
import type { OverrideOp } from "@/lib/timetable";

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

function parsePatchFile(json: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("JSONの解析に失敗しました。有効なJSONファイルか確認してください。");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.format !== "timetable-patch/v1") {
    throw new Error(
      `フォーマットが不正です。"format": "timetable-patch/v1" が必要ですが、"${obj.format}" が指定されています。`
    );
  }

  if (obj.mode !== "partial" && obj.mode !== "full_replace") {
    throw new Error(
      `"mode" は "partial" または "full_replace" を指定してください（現在: "${obj.mode}"）。`
    );
  }

  if (!Array.isArray(obj.ops) || obj.ops.length === 0) {
    throw new Error('"ops" 配列が空か、存在しません。操作リストを指定してください。');
  }

  const warnings: string[] = [];
  const validOps: OverrideOp[] = [];
  const dateSet = new Set<string>();

  for (let i = 0; i < (obj.ops as unknown[]).length; i++) {
    const op = (obj.ops as Record<string, unknown>[])[i];
    if (!op.op || !op.date) {
      warnings.push(`ops[${i}]: "op" または "date" フィールドがありません。スキップします。`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(op.date as string)) {
      warnings.push(`ops[${i}]: 日付フォーマットが不正です（"${op.date}"）。YYYY-MM-DD 形式で指定してください。`);
      continue;
    }
    dateSet.add(op.date as string);
    validOps.push(op as unknown as OverrideOp);
  }

  if (validOps.length === 0) {
    throw new Error("有効な操作が1件もありません。ops の内容を確認してください。");
  }

  const affectedDates = Array.from(dateSet).sort();

  return {
    patch: { ...(obj as unknown as TimetablePatch), ops: validOps },
    warnings,
    opsCount: validOps.length,
    affectedDates,
  };
}

// ─── Component ────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PatchImportDialog({ open, onClose }: Props) {
  const { applyOps } = useTimetable();
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
      setParseError("JSONファイル（.json）のみ対応しています。");
      setParseResult(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = parsePatchFile(e.target?.result as string);
        setParseResult(result);
        setParseError(null);
      } catch (err) {
        setParseError((err as Error).message);
        setParseResult(null);
      }
    };
    reader.readAsText(file, "utf-8");
  }, []);

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
        `インポート完了: ${parseResult.opsCount}件の操作を適用しました`,
        { description: parseResult.patch.description ?? undefined }
      );
      onClose();
    } catch (err) {
      toast.error("インポートに失敗しました", { description: (err as Error).message });
    } finally {
      setIsApplying(false);
    }
  };

  const modeLabel = parseResult?.patch.mode === "full_replace" ? "全書き換え" : "部分書き換え";
  const modeColor = parseResult?.patch.mode === "full_replace" ? "text-red-600" : "text-blue-600";
  const modeBg = parseResult?.patch.mode === "full_replace" ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200";

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg w-[95vw] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Upload size={16} />
            パッチインポート
          </DialogTitle>
        </DialogHeader>

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
                <p className="text-sm font-medium text-green-700">ファイルを読み込みました</p>
                <p className="text-xs text-muted-foreground">別のファイルを選ぶにはここをクリック</p>
              </div>
            ) : parseError ? (
              <div className="flex flex-col items-center gap-2">
                <AlertTriangle size={28} className="text-red-500" />
                <p className="text-sm font-medium text-red-700">読み込みエラー</p>
                <p className="text-xs text-muted-foreground">別のファイルを選ぶにはここをクリック</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FileJson size={28} className="text-muted-foreground" />
                <p className="text-sm font-medium">JSONファイルをドロップ</p>
                <p className="text-xs text-muted-foreground">またはクリックしてファイルを選択</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">timetable-patch/v1 形式のみ対応</p>
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
                  <span className={cn("font-bold", modeColor)}>モード: {modeLabel}</span>
                  {parseResult.patch.mode === "full_replace" && (
                    <p className="text-xs text-red-600 mt-0.5">
                      指定期間の全コマを上書きします。元に戻すには「変更履歴」から取り消してください。
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
                  <span className="text-muted-foreground">操作数</span>
                  <span className="font-medium">{parseResult.opsCount} 件</span>
                  <span className="text-muted-foreground">対象日数</span>
                  <span className="font-medium">{parseResult.affectedDates.length} 日</span>
                  {parseResult.patch.dateRange && (
                    <>
                      <span className="text-muted-foreground">期間</span>
                      <span className="font-medium">
                        {parseResult.patch.dateRange.start} 〜 {parseResult.patch.dateRange.end}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">最初の日付</span>
                  <span className="font-medium">{parseResult.affectedDates[0]}</span>
                  <span className="text-muted-foreground">最後の日付</span>
                  <span className="font-medium">{parseResult.affectedDates[parseResult.affectedDates.length - 1]}</span>
                </div>
              </div>

              {/* Warnings */}
              {parseResult.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                  <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                    <AlertTriangle size={12} />
                    警告 ({parseResult.warnings.length}件) — スキップされた操作があります
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
            キャンセル
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
              "適用中..."
            ) : (
              <>
                <Upload size={13} />
                {parseResult?.patch.mode === "full_replace" ? "全書き換えで適用" : "部分適用"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
