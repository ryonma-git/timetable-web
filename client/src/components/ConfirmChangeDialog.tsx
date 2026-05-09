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
import { useLanguage } from "@/contexts/LanguageContext";
import { getClassColor } from "@/lib/gradeColors";

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
  const { t } = useLanguage();
  const color = getClassColor(cls, gradeColors);

  if (!cls) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground border border-border">
        {t("confirmChange.empty")}{reason ? ` (${reason})` : ""}
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
  const { language, t } = useLanguage();
  if (!date && !period) return null;
  const formattedDate = (() => {
    if (!date) return "";
    const d = new Date(date + "T00:00:00");
    if (language === "ja") {
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
      return `${m}/${day}（${weekdays[d.getDay()]}）`;
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
  })();
  return (
    <span className="text-xs text-muted-foreground">
      {formattedDate}
      {period ? (language === "ja" ? ` ${period}${t("weekGrid.periodSuffix")}` : ` ${t("weekGrid.periodSuffix")} ${period}`) : ""}
    </span>
  );
}

const OP_COLORS: Record<ChangeOpType, string> = {
  delete: "text-destructive",
  add: "text-green-600",
  move: "text-blue-600",
  swap: "text-violet-600",
};

export function ConfirmChangeDialog({ open, preview, onConfirm, onCancel }: Props) {
  const { t } = useLanguage();
  if (!preview) return null;

  const opLabel = {
    delete: t("confirmChange.delete"),
    add: t("confirmChange.add"),
    move: t("confirmChange.move"),
    swap: t("confirmChange.swap"),
  }[preview.opType];
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
            <span>{t("confirmChange.title")}</span>
            <span className={`text-sm font-normal ${OP_COLORS[preview.opType]}`}>- {opLabel}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Warnings */}
          {hasWarnings && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-1">
              <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                <AlertTriangle size={12} />
                {t("confirmChange.warning")}
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
            {t("confirmChange.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            variant={hasWarnings ? "destructive" : "default"}
            className="gap-1.5"
          >
            {hasWarnings ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}
            {hasWarnings ? t("confirmChange.runWithWarnings") : t("confirmChange.run")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
