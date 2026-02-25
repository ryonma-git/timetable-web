// ConfirmChangeDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// Confirmation dialog showing before/after preview for timetable operations

import { AlertTriangle, ArrowRight, CheckCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { getClassColor } from "@/lib/gradeColors";
import { formatDateJP } from "@/lib/timetable";

export type ChangeOpType = "delete" | "add" | "move" | "swap";

export interface ChangePreview {
  opType: ChangeOpType;
  description: string;
  items: ChangePreviewItem[];
  warnings?: string[];
}

export interface ChangePreviewItem {
  label: string;
  fromDate?: string;
  fromPeriod?: number;
  fromClass?: string | null;
  fromReason?: string;
  toDate?: string;
  toPeriod?: number;
  toClass?: string | null;
  toReason?: string;
}

interface Props {
  open: boolean;
  preview: ChangePreview | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function ClassBadge({ cls, reason }: { cls: string | null; reason?: string }) {
  const { gradeColors } = useGradeColors();
  const color = getClassColor(cls, gradeColors);

  if (!cls) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground border border-border">
        空き{reason ? ` (${reason})` : ""}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border"
      style={{ backgroundColor: color.bg, borderColor: color.border, color: color.text }}
    >
      {cls}{reason ? ` (${reason})` : ""}
    </span>
  );
}

function PeriodLabel({ date, period }: { date?: string; period?: number }) {
  if (!date && !period) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {date ? formatDateJP(date) : ""}
      {period ? ` ${period}限` : ""}
    </span>
  );
}

const OP_LABELS: Record<ChangeOpType, { label: string; color: string }> = {
  delete: { label: "削除", color: "text-destructive" },
  add: { label: "追加", color: "text-green-600" },
  move: { label: "移動", color: "text-blue-600" },
  swap: { label: "交換", color: "text-violet-600" },
};

export function ConfirmChangeDialog({ open, preview, onConfirm, onCancel }: Props) {
  if (!preview) return null;

  const opInfo = OP_LABELS[preview.opType];
  const hasWarnings = (preview.warnings?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={v => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasWarnings ? (
              <AlertTriangle size={18} className="text-amber-500" />
            ) : (
              <CheckCircle size={18} className="text-green-500" />
            )}
            <span>変更の確認</span>
            <span className={`text-sm font-normal ${opInfo.color}`}>— {opInfo.label}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Warnings */}
          {hasWarnings && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-1">
              <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                <AlertTriangle size={12} />
                警告
              </p>
              {preview.warnings!.map((w, i) => (
                <p key={i} className="text-xs text-amber-600">{w}</p>
              ))}
            </div>
          )}

          {/* Description */}
          <p className="text-sm text-foreground">{preview.description}</p>

          {/* Before/After items */}
          <div className="space-y-3">
            {preview.items.map((item, i) => (
              <div key={i} className="bg-muted/30 rounded-md p-3 space-y-2">
                {item.label && (
                  <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* From */}
                  <div className="flex flex-col gap-1">
                    <PeriodLabel date={item.fromDate} period={item.fromPeriod} />
                    <ClassBadge cls={item.fromClass ?? null} reason={item.fromReason} />
                  </div>

                  {/* Arrow */}
                  <ArrowRight size={14} className="text-muted-foreground shrink-0" />

                  {/* To */}
                  <div className="flex flex-col gap-1">
                    <PeriodLabel date={item.toDate} period={item.toPeriod} />
                    <ClassBadge cls={item.toClass ?? null} reason={item.toReason} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            variant={hasWarnings ? "destructive" : "default"}
            className="gap-1.5"
          >
            {hasWarnings ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}
            {hasWarnings ? "警告を無視して実行" : "実行"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
