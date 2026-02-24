// Inspector.tsx
// Design: Swiss Grid × Japanese Functional Design
// Right inspector panel: cell details + operation form

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, X } from "lucide-react";
import { toast } from "sonner";
import { useTimetable } from "@/contexts/TimetableContext";
import {
  buildAddOp,
  buildDeleteOp,
  buildMoveOps,
  buildReasonOp,
  buildSwapOps,
  REASON_PRESETS,
  TimetableEntry,
  VALID_CLASSES,
  validateOp,
} from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type OpMode = "delete" | "add" | "move" | "swap" | "reason";

export function Inspector() {
  const {
    selectedCell, setSelectedCell,
    effectiveEntries, applyOps,
  } = useTimetable();

  const [opMode, setOpMode] = useState<OpMode>("delete");
  const [newClass, setNewClass] = useState("");
  const [reason, setReason] = useState("");
  const [dstDate, setDstDate] = useState("");
  const [dstPeriod, setDstPeriod] = useState("1");
  const [swapDate, setSwapDate] = useState("");
  const [swapPeriod, setSwapPeriod] = useState("1");
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);

  // Get current slot info
  const entryByDate = new Map<string, TimetableEntry>();
  effectiveEntries.forEach(e => entryByDate.set(e.date, e));

  const currentEntry = selectedCell ? entryByDate.get(selectedCell.date) : null;
  const currentSlot = currentEntry?.periods.find(p => p.period === selectedCell?.period);

  // Available dates for move/swap
  const availableDates = effectiveEntries.map(e => e.date).sort();

  useEffect(() => {
    if (selectedCell) {
      setConfirmMismatch(false);
      setPendingWarning(null);
    }
  }, [selectedCell]);

  if (!selectedCell) {
    return (
      <div className="w-[260px] shrink-0 border-l border-border flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground/60">コマを選択してください</p>
            <p className="text-xs text-muted-foreground mt-1">グリッドのセルをクリックすると<br />操作パネルが表示されます</p>
          </div>
        </div>
      </div>
    );
  }

  const handleExecute = () => {
    if (!selectedCell) return;
    const { date, period } = selectedCell;
    const currentClass = currentSlot?.class ?? null;

    // Build ops based on mode
    let ops: ReturnType<typeof buildDeleteOp>[] = [];
    let description = "";

    if (opMode === "delete") {
      const op = buildDeleteOp(date, period, currentClass, reason || undefined);
      const v = validateOp(op);
      if (!v.valid) { toast.error(v.errors.join("\n")); return; }
      if (v.warnings.length > 0 && !confirmMismatch) {
        setPendingWarning(v.warnings.join("\n"));
        return;
      }
      ops = [op];
      description = `削除: ${date} ${period}限 (${currentClass ?? "空き"})`;
    } else if (opMode === "add") {
      if (!newClass) { toast.error("クラスを選択してください"); return; }
      const op = buildAddOp(date, period, newClass, reason || undefined);
      const v = validateOp(op);
      if (!v.valid) { toast.error(v.errors.join("\n")); return; }
      ops = [op];
      description = `追加: ${date} ${period}限 → ${newClass}`;
    } else if (opMode === "move") {
      if (!dstDate) { toast.error("移動先の日付を選択してください"); return; }
      const dstSlot = entryByDate.get(dstDate)?.periods.find(p => p.period === Number(dstPeriod));
      ops = buildMoveOps(date, period, currentClass, dstDate, Number(dstPeriod), dstSlot?.class ?? null, reason || undefined);
      description = `移動: ${date} ${period}限 → ${dstDate} ${dstPeriod}限`;
    } else if (opMode === "swap") {
      if (!swapDate) { toast.error("交換先の日付を選択してください"); return; }
      const swapSlot = entryByDate.get(swapDate)?.periods.find(p => p.period === Number(swapPeriod));
      ops = buildSwapOps(date, period, currentClass, swapDate, Number(swapPeriod), swapSlot?.class ?? null, reason || undefined);
      description = `交換: ${date} ${period}限 ↔ ${swapDate} ${swapPeriod}限`;
    } else if (opMode === "reason") {
      if (!reason) { toast.error("理由を入力してください"); return; }
      ops = [buildReasonOp(date, period, reason)];
      description = `理由設定: ${date} ${period}限`;
    }

    const audit = applyOps(ops, description);
    const warnings = audit.filter(a => a.level === "warn");
    const errors = audit.filter(a => a.level === "error");

    if (errors.length > 0) {
      toast.error(errors.map(e => e.message).join("\n"));
    } else if (warnings.length > 0) {
      toast.warning(`完了（警告あり）: ${warnings.map(w => w.message).join(", ")}`);
    } else {
      toast.success(description);
    }

    setConfirmMismatch(false);
    setPendingWarning(null);
    setReason("");
    setNewClass("");
  };

  const opModes: { id: OpMode; label: string; color: string }[] = [
    { id: "delete", label: "削除", color: "text-red-600" },
    { id: "add", label: "追加", color: "text-blue-600" },
    { id: "move", label: "移動", color: "text-amber-600" },
    { id: "swap", label: "交換", color: "text-emerald-600" },
    { id: "reason", label: "理由", color: "text-purple-600" },
  ];

  return (
    <div className="w-[260px] shrink-0 border-l border-border flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="text-xs text-muted-foreground">選択中のコマ</p>
          <p className="text-sm font-bold text-foreground">
            {selectedCell.date.slice(5).replace("-", "/")} — {selectedCell.period}限
          </p>
        </div>
        <button
          onClick={() => setSelectedCell(null)}
          className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted transition-colors"
        >
          <X size={13} className="text-muted-foreground" />
        </button>
      </div>

      {/* Current slot info */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            currentSlot?.class ? "bg-primary" : "bg-muted-foreground/30"
          )} />
          <div>
            <p className="text-sm font-semibold">
              {currentSlot?.class ?? <span className="text-muted-foreground font-normal">授業なし</span>}
            </p>
            {currentSlot?.reason && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{currentSlot.reason}</p>
            )}
          </div>
        </div>
      </div>

      {/* Op mode tabs */}
      <div className="px-3 pt-3">
        <div className="flex gap-1 flex-wrap">
          {opModes.map(m => (
            <button
              key={m.id}
              onClick={() => { setOpMode(m.id); setConfirmMismatch(false); setPendingWarning(null); }}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors border",
                opMode === m.id
                  ? `bg-primary text-primary-foreground border-primary`
                  : `bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground`
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Warning */}
        {pendingWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-amber-700">警告</p>
                <p className="text-[11px] text-amber-600 mt-0.5">{pendingWarning}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100"
                onClick={() => { setConfirmMismatch(true); setPendingWarning(null); setTimeout(handleExecute, 0); }}
              >
                続行
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs"
                onClick={() => { setConfirmMismatch(false); setPendingWarning(null); }}
              >
                キャンセル
              </Button>
            </div>
          </div>
        )}

        {/* Delete mode */}
        {opMode === "delete" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{currentSlot?.class ?? "空きコマ"}</span> を削除します
            </p>
            <ReasonField reason={reason} setReason={setReason} />
          </div>
        )}

        {/* Add mode */}
        {opMode === "add" && (
          <div className="space-y-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">クラス</Label>
              <Select value={newClass} onValueChange={setNewClass}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="クラスを選択..." />
                </SelectTrigger>
                <SelectContent>
                  {VALID_CLASSES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ReasonField reason={reason} setReason={setReason} />
          </div>
        )}

        {/* Move mode */}
        {opMode === "move" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">移動先を指定してください</p>
            <DatePeriodPicker
              label="移動先"
              dates={availableDates}
              date={dstDate} setDate={setDstDate}
              period={dstPeriod} setPeriod={setDstPeriod}
            />
            <ReasonField reason={reason} setReason={setReason} />
          </div>
        )}

        {/* Swap mode */}
        {opMode === "swap" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">交換先を指定してください</p>
            <DatePeriodPicker
              label="交換先"
              dates={availableDates}
              date={swapDate} setDate={setSwapDate}
              period={swapPeriod} setPeriod={setSwapPeriod}
            />
            {swapDate && swapPeriod && (
              <div className="bg-muted/50 rounded p-2 text-xs text-muted-foreground">
                交換先: <span className="font-medium text-foreground">
                  {entryByDate.get(swapDate)?.periods.find(p => p.period === Number(swapPeriod))?.class ?? "空き"}
                </span>
              </div>
            )}
            <ReasonField reason={reason} setReason={setReason} />
          </div>
        )}

        {/* Reason mode */}
        {opMode === "reason" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">理由を設定します（既存の理由を上書き）</p>
            <ReasonField reason={reason} setReason={setReason} required />
          </div>
        )}
      </div>

      {/* Execute button */}
      <div className="px-4 py-3 border-t border-border">
        <Button
          className="w-full h-9 text-sm font-medium"
          onClick={handleExecute}
          disabled={!!pendingWarning}
        >
          {opMode === "delete" && "削除を実行"}
          {opMode === "add" && "追加を実行"}
          {opMode === "move" && "移動を実行"}
          {opMode === "swap" && "交換を実行"}
          {opMode === "reason" && "理由を設定"}
        </Button>
      </div>
    </div>
  );
}

// ─── Sub Components ───────────────────────────────────────────

function ReasonField({
  reason, setReason, required = false
}: {
  reason: string; setReason: (v: string) => void; required?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">
        理由{required ? " *" : " (任意)"}
      </Label>
      <div className="space-y-1.5">
        <Input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="理由を入力..."
          className="h-8 text-sm"
        />
        <div className="flex flex-wrap gap-1">
          {REASON_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => setReason(p)}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                reason === p
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DatePeriodPicker({
  label, dates, date, setDate, period, setPeriod
}: {
  label: string;
  dates: string[];
  date: string; setDate: (v: string) => void;
  period: string; setPeriod: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">{label}の日付</Label>
        <Select value={date} onValueChange={setDate}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="日付を選択..." />
          </SelectTrigger>
          <SelectContent className="max-h-48">
            {dates.map(d => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">{label}の時限</Label>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6].map(p => (
              <SelectItem key={p} value={String(p)}>{p}限</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
