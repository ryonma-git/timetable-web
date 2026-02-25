// Inspector.tsx
// Design: Swiss Grid × Japanese Functional Design
// Right inspector panel: cell details + operation form with confirm dialog
// Phase 3: 教科入力対応（single_subject/homeroom/multi_subjectモード）

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useTimetable } from "@/contexts/TimetableContext";
import {
  buildAddOp,
  buildDeleteOp,
  buildMoveOps,
  buildReasonOp,
  buildSetSubjectOp,
  buildSwapOps,
  formatDateJP,
  REASON_PRESETS,
  TimetableEntry,
  VALID_CLASSES,
  validateOp,
} from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ConfirmChangeDialog, ChangePreview, ChangeOpType } from "@/components/ConfirmChangeDialog";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { getClassColor, getSubjectColor } from "@/lib/gradeColors";

type OpMode = "delete" | "add" | "move" | "swap" | "reason" | "subject";

export function Inspector() {
  const {
    selectedCell, setSelectedCell,
    effectiveEntries, applyOps,
    customClasses,
    classList,
    mode,
    subjects,
    semester,
  } = useTimetable();

  // classListが空の場合はVALID_CLASSESにフォールバック
  const effectiveClassList = classList.length > 0 ? classList : [];
  const { gradeColors, subjectColors } = useGradeColors();

  const isHomeroomMode = mode === 'homeroom';
  const isMultiSubjectMode = mode === 'multi_subject';
  const hasSubjects = subjects.length > 0;
  const showSubjectOp = hasSubjects || isHomeroomMode || isMultiSubjectMode;

  // homeroomモードでは担任クラスを固定
  const homeroomClass = semester?.homeroomClass ?? null;

  const [opMode, setOpMode] = useState<OpMode>("delete");
  const [newClass, setNewClass] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [reason, setReason] = useState("");
  const [dstDate, setDstDate] = useState("");
  const [dstPeriod, setDstPeriod] = useState("1");
  const [swapDate, setSwapDate] = useState("");
  const [swapPeriod, setSwapPeriod] = useState("1");

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPreview, setConfirmPreview] = useState<ChangePreview | null>(null);
  const [pendingExecute, setPendingExecute] = useState<(() => void) | null>(null);

  // Build entry lookup
  const entryByDate = new Map<string, TimetableEntry>();
  effectiveEntries.forEach(e => entryByDate.set(e.date, e));

  const currentEntry = selectedCell ? entryByDate.get(selectedCell.date) : null;
  const currentSlot = currentEntry?.periods.find(p => p.period === selectedCell?.period);
  const availableDates = effectiveEntries.map(e => e.date).sort();

  useEffect(() => {
    if (selectedCell) {
      setConfirmOpen(false);
      setConfirmPreview(null);
      setPendingExecute(null);
    }
  }, [selectedCell]);

  if (!selectedCell) {
    // コマ未選択時は非表示（デスクトップ・スマホ共通）
    return null;
  }

  const { date, period } = selectedCell;
  const currentClass = currentSlot?.class ?? null;
  const currentSubject = currentSlot?.subject ?? null;

  // ─── Build preview and show confirm dialog ─────────────────
  const showConfirm = (
    opType: ChangeOpType,
    description: string,
    preview: ChangePreview,
    execute: () => void
  ) => {
    setConfirmPreview(preview);
    setConfirmOpen(true);
    setPendingExecute(() => execute);
  };

  const handleExecute = () => {
    if (!selectedCell) return;

    if (opMode === "delete") {
      const op = buildDeleteOp(date, period, currentClass, reason || undefined);
      const v = validateOp(op);
      if (!v.valid) { toast.error(v.errors.join("\n")); return; }

      const preview: ChangePreview = {
        opType: "delete",
        description: `${formatDateJP(date)} ${period}限の授業を削除します`,
        items: [{
          label: "",
          fromDate: date, fromPeriod: period, fromClass: currentClass, fromReason: currentSlot?.reason,
          toDate: date, toPeriod: period, toClass: null, toReason: reason || undefined,
        }],
        warnings: v.warnings,
      };

      showConfirm("delete", `削除: ${date} ${period}限`, preview, () => {
        const audit = applyOps([op], `削除: ${date} ${period}限 (${currentClass ?? "空き"})`);
        const errors = audit.filter(a => a.level === "error");
        if (errors.length > 0) toast.error(errors.map(e => e.message).join("\n"));
        else toast.success(`削除しました: ${formatDateJP(date)} ${period}限`);
        setReason("");
      });

    } else if (opMode === "add") {
      // homeroomモードではクラスを担任クラスに固定
      const targetClass = isHomeroomMode ? (homeroomClass ?? "") : newClass;
      if (!targetClass) {
        if (isHomeroomMode) toast.error("担任クラスが設定されていません（設定から変更できます）");
        else toast.error("クラスを選択してください");
        return;
      }
      const op = buildAddOp(date, period, targetClass, reason || undefined, newSubject || undefined);
      const v = validateOp(op);
      if (!v.valid) { toast.error(v.errors.join("\n")); return; }

      const preview: ChangePreview = {
        opType: "add",
        description: `${formatDateJP(date)} ${period}限に授業を追加します`,
        items: [{
          label: "",
          fromDate: date, fromPeriod: period, fromClass: currentClass,
          toDate: date, toPeriod: period, toClass: targetClass, toReason: reason || undefined,
        }],
        warnings: v.warnings,
      };

      const displayLabel = newSubject ? `${targetClass} / ${newSubject}` : targetClass;
      showConfirm("add", `追加: ${date} ${period}限 → ${displayLabel}`, preview, () => {
        const audit = applyOps([op], `追加: ${date} ${period}限 → ${displayLabel}`);
        const errors = audit.filter(a => a.level === "error");
        if (errors.length > 0) toast.error(errors.map(e => e.message).join("\n"));
        else toast.success(`追加しました: ${displayLabel}`);
        setNewClass(""); setNewSubject(""); setReason("");
      });

    } else if (opMode === "move") {
      if (!dstDate) { toast.error("移動先の日付を選択してください"); return; }
      const dstSlot = entryByDate.get(dstDate)?.periods.find(p => p.period === Number(dstPeriod));
      const ops = buildMoveOps(date, period, currentClass, dstDate, Number(dstPeriod), dstSlot?.class ?? null, reason || undefined, currentSubject);

      const preview: ChangePreview = {
        opType: "move",
        description: `${formatDateJP(date)} ${period}限を ${formatDateJP(dstDate)} ${dstPeriod}限に移動します`,
        items: [
          {
            label: "移動元",
            fromDate: date, fromPeriod: period, fromClass: currentClass,
            toDate: date, toPeriod: period, toClass: null,
          },
          {
            label: "移動先",
            fromDate: dstDate, fromPeriod: Number(dstPeriod), fromClass: dstSlot?.class ?? null,
            toDate: dstDate, toPeriod: Number(dstPeriod), toClass: currentClass, toReason: reason || undefined,
          },
        ],
        warnings: dstSlot?.class ? [`移動先 (${formatDateJP(dstDate)} ${dstPeriod}限) には ${dstSlot.class} が入っています。上書きされます。`] : [],
      };

      showConfirm("move", `移動: ${date} ${period}限 → ${dstDate} ${dstPeriod}限`, preview, () => {
        const audit = applyOps(ops, `移動: ${date} ${period}限 → ${dstDate} ${dstPeriod}限`);
        const errors = audit.filter(a => a.level === "error");
        if (errors.length > 0) toast.error(errors.map(e => e.message).join("\n"));
        else toast.success(`移動しました`);
        setReason("");
      });

    } else if (opMode === "swap") {
      if (!swapDate) { toast.error("交換先の日付を選択してください"); return; }
      const swapSlot = entryByDate.get(swapDate)?.periods.find(p => p.period === Number(swapPeriod));
      const ops = buildSwapOps(date, period, currentClass, swapDate, Number(swapPeriod), swapSlot?.class ?? null, reason || undefined, currentSubject, swapSlot?.subject);

      const preview: ChangePreview = {
        opType: "swap",
        description: `${formatDateJP(date)} ${period}限 と ${formatDateJP(swapDate)} ${swapPeriod}限 を交換します`,
        items: [
          {
            label: `${formatDateJP(date)} ${period}限`,
            fromClass: currentClass,
            toClass: swapSlot?.class ?? null,
          },
          {
            label: `${formatDateJP(swapDate)} ${swapPeriod}限`,
            fromClass: swapSlot?.class ?? null,
            toClass: currentClass,
          },
        ],
        warnings: [],
      };

      showConfirm("swap", `交換: ${date} ${period}限 ↔ ${swapDate} ${swapPeriod}限`, preview, () => {
        const audit = applyOps(ops, `交換: ${date} ${period}限 ↔ ${swapDate} ${swapPeriod}限`);
        const errors = audit.filter(a => a.level === "error");
        if (errors.length > 0) toast.error(errors.map(e => e.message).join("\n"));
        else toast.success(`交換しました`);
      });

    } else if (opMode === "reason") {
      if (!reason) { toast.error("理由を入力してください"); return; }
      const ops = [buildReasonOp(date, period, reason)];

      const preview: ChangePreview = {
        opType: "add",
        description: `${formatDateJP(date)} ${period}限の理由を設定します`,
        items: [{
          label: "",
          fromDate: date, fromPeriod: period, fromClass: currentClass, fromReason: currentSlot?.reason,
          toDate: date, toPeriod: period, toClass: currentClass, toReason: reason,
        }],
        warnings: [],
      };

      showConfirm("add", `理由設定: ${date} ${period}限`, preview, () => {
        applyOps(ops, `理由設定: ${date} ${period}限`);
        toast.success(`理由を設定しました`);
        setReason("");
      });

    } else if (opMode === "subject") {
      // 教科のみ変更（クラスは維持）
      const subjectValue = newSubject || null;
      const op = buildSetSubjectOp(date, period, currentClass, subjectValue);

      const preview: ChangePreview = {
        opType: "add",
        description: `${formatDateJP(date)} ${period}限の教科を設定します`,
        items: [{
          label: "",
          fromDate: date, fromPeriod: period, fromClass: currentClass,
          toDate: date, toPeriod: period, toClass: currentClass,
        }],
        warnings: [],
      };

      showConfirm("add", `教科設定: ${date} ${period}限 → ${subjectValue ?? "なし"}`, preview, () => {
        applyOps([op], `教科設定: ${date} ${period}限 → ${subjectValue ?? "なし"}`);
        toast.success(subjectValue ? `教科を「${subjectValue}」に設定しました` : "教科を削除しました");
        setNewSubject("");
      });
    }
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    if (pendingExecute) {
      pendingExecute();
      setPendingExecute(null);
      setConfirmPreview(null);
    }
  };

  const handleCancelConfirm = () => {
    setConfirmOpen(false);
    setPendingExecute(null);
    setConfirmPreview(null);
  };

  const opModes: { id: OpMode; label: string }[] = [
    { id: "delete", label: "削除" },
    { id: "add", label: "追加" },
    { id: "move", label: "移動" },
    { id: "swap", label: "交換" },
    { id: "reason", label: "理由" },
    ...(showSubjectOp ? [{ id: "subject" as OpMode, label: "教科" }] : []),
  ];

  // Color for current cell
  const cellColors = (() => {
    if ((isHomeroomMode || isMultiSubjectMode) && currentSubject) {
      return getSubjectColor(currentSubject, subjectColors);
    }
    if (currentClass) return getClassColor(currentClass, gradeColors);
    return null;
  })();

  return (
    <>
      {/* Mobile: bottom sheet overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40 lg:hidden"
        onClick={() => setSelectedCell(null)}
      />

      {/* Panel: desktop = right side, mobile = bottom sheet */}
      <div className="
        fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl shadow-2xl
        lg:static lg:w-[260px] lg:shrink-0 lg:rounded-none lg:shadow-none lg:z-auto
        border-t lg:border-t-0 lg:border-l border-border
        flex flex-col bg-card
        animate-in slide-in-from-bottom lg:slide-in-from-right duration-200
        max-h-[80vh] lg:max-h-none
      ">
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-2 pb-1 lg:hidden">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <p className="text-xs text-muted-foreground">選択中のコマ</p>
            <p className="text-sm font-bold text-foreground">
              {formatDateJP(date)} — {period}限
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
            <div
              className="w-3 h-3 rounded-full border"
              style={cellColors
                ? { backgroundColor: cellColors.bg, borderColor: cellColors.border }
                : { backgroundColor: 'var(--muted)', borderColor: 'var(--border)' }
              }
            />
            <div>
              {isHomeroomMode ? (
                // Homeroom: show subject (or class if no subject)
                <p className="text-sm font-semibold" style={cellColors ? { color: cellColors.text } : {}}>
                  {currentSubject
                    ? currentSubject
                    : currentClass
                      ? currentClass
                      : <span className="text-muted-foreground font-normal">授業なし</span>
                  }
                </p>
              ) : (
                <>
                  <p className="text-sm font-semibold" style={currentClass ? { color: cellColors?.text } : {}}>
                    {currentClass ?? <span className="text-muted-foreground font-normal">授業なし</span>}
                  </p>
                  {currentSubject && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">教科: {currentSubject}</p>
                  )}
                </>
              )}
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
                onClick={() => setOpMode(m.id)}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors border",
                  opMode === m.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Delete mode */}
          {opMode === "delete" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {isHomeroomMode
                    ? (currentSubject ?? currentClass ?? "空きコマ")
                    : (currentClass ?? "空きコマ")
                  }
                </span> を削除します
              </p>
              <ReasonField reason={reason} setReason={setReason} />
            </div>
          )}

          {/* Add mode */}
          {opMode === "add" && (
            <div className="space-y-2">
              {/* Class field (hidden in homeroom mode) */}
              {!isHomeroomMode && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">クラス</Label>
                  <Select value={newClass} onValueChange={setNewClass}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="クラスを選択..." />
                    </SelectTrigger>
                    <SelectContent>
                      {effectiveClassList.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Homeroom mode: show fixed class info */}
              {isHomeroomMode && homeroomClass && (
                <div className="bg-muted/50 rounded p-2 text-xs text-muted-foreground">
                  担任クラス: <span className="font-medium text-foreground">{homeroomClass}</span>
                </div>
              )}
              {/* Subject field (shown when subjects are available) */}
              {(hasSubjects || isHomeroomMode) && (
                <SubjectField
                  value={newSubject}
                  onChange={setNewSubject}
                  subjects={subjects.map(s => s.name)}
                  required={isHomeroomMode}
                />
              )}
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
              {dstDate && dstPeriod && (() => {
                const dstSlot = entryByDate.get(dstDate)?.periods.find(p => p.period === Number(dstPeriod));
                return dstSlot?.class ? (
                  <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700">
                    ⚠ 移動先に <strong>{dstSlot.class}</strong> が入っています（上書きされます）
                  </div>
                ) : null;
              })()}
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

          {/* Subject mode */}
          {opMode === "subject" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                このコマの教科を設定します
                {currentSubject && <span className="ml-1">(現在: <strong>{currentSubject}</strong>)</span>}
              </p>
              <SubjectField
                value={newSubject}
                onChange={setNewSubject}
                subjects={subjects.map(s => s.name)}
                allowEmpty
                emptyLabel="教科なし（削除）"
              />
            </div>
          )}
        </div>

        {/* Execute button */}
        <div className="px-4 py-3 border-t border-border">
          <Button
            className="w-full h-9 text-sm font-medium"
            onClick={handleExecute}
          >
            {opMode === "delete" && "削除を確認"}
            {opMode === "add" && "追加を確認"}
            {opMode === "move" && "移動を確認"}
            {opMode === "swap" && "交換を確認"}
            {opMode === "reason" && "理由を設定"}
            {opMode === "subject" && "教科を設定"}
          </Button>
        </div>
      </div>

      {/* Confirm dialog */}
      <ConfirmChangeDialog
        open={confirmOpen}
        preview={confirmPreview}
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
      />
    </>
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

function SubjectField({
  value, onChange, subjects, required = false, allowEmpty = false, emptyLabel = "教科なし"
}: {
  value: string;
  onChange: (v: string) => void;
  subjects: string[];
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">
        教科{required ? " *" : " (任意)"}
      </Label>
      <Select value={value || (allowEmpty ? "__none__" : "")} onValueChange={v => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="教科を選択..." />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty && (
            <SelectItem value="__none__">{emptyLabel}</SelectItem>
          )}
          {subjects.map(s => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
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
