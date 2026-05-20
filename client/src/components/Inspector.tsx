// Inspector.tsx
// Design: Swiss Grid × Japanese Functional Design
// Right inspector panel: cell details + operation form with confirm dialog
// Phase 3: 教科入力対応（single_subject/homeroom/multi_subjectモード）
// Phase 4: 複数選択モード対応（一括削除・追加・教科・理由）

import { useEffect, useState } from "react";
import { X, CheckSquare } from "lucide-react";
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
import { useLanguage, type TranslationKey } from "@/contexts/LanguageContext";

type OpMode = "delete" | "add" | "move" | "swap" | "reason" | "subject";
type MultiOpMode = "delete" | "add" | "reason" | "subject";

export function Inspector() {
  const {
    selectedCell, setSelectedCell,
    multiSelectMode, setMultiSelectMode, selectedCells, clearSelectedCells,
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
  const { t } = useLanguage();
  // {token} を変数で置換する簡易フォーマッタ（t()は補間非対応のため）
  const tf = (key: TranslationKey, vars: Record<string, string | number>) => {
    let s: string = t(key);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
  // "5/12(月) 3限" 形式の日付+時限ラベル（日付フォーマット自体は別対応）
  const pLabel = (d: string, p: number | string) => `${formatDateJP(d)} ${p}${t("audit.periodSuffix")}`;

  const isHomeroomMode = mode === 'homeroom';
  const isMultiSubjectMode = mode === 'multi_subject';
  const hasSubjects = subjects.length > 0;
  const showSubjectOp = hasSubjects;

  // homeroomモードでは担任クラスを固定
  const homeroomClass = semester?.homeroomClass ?? null;

  const [opMode, setOpMode] = useState<OpMode>("delete");
  const [multiOpMode, setMultiOpMode] = useState<MultiOpMode>("delete");
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

  // ─── 複数選択モード: 選択コマのパース ─────────────────────────
  const parsedSelectedCells = Array.from(selectedCells).map(key => {
    const [date, periodStr] = key.split("|");
    return { date, period: Number(periodStr) };
  });

  // ─── 複数選択モードの一括操作 ─────────────────────────────────
  const handleMultiExecute = () => {
    if (selectedCells.size === 0) {
      toast.error(t("inspector.errNoSelection"));
      return;
    }
    if (multiOpMode === "delete") {
      const ops = parsedSelectedCells.flatMap(({ date, period }) => {
        const slot = entryByDate.get(date)?.periods.find(p => p.period === period);
        return [buildDeleteOp(date, period, slot?.class ?? null, reason || undefined)];
      });
      const preview: ChangePreview = {
        opType: "delete",
        description: tf("inspector.batchDeleteDesc", { n: selectedCells.size }),
        items: parsedSelectedCells.map(({ date, period }) => {
          const slot = entryByDate.get(date)?.periods.find(p => p.period === period);
          return {
            label: pLabel(date, period),
            fromDate: date, fromPeriod: period, fromClass: slot?.class ?? null,
            toDate: date, toPeriod: period, toClass: null,
          };
        }),
        warnings: [],
      };
      setConfirmPreview(preview);
      setConfirmOpen(true);
      setPendingExecute(() => () => {
        const audit = applyOps(ops, `一括削除: ${selectedCells.size}コマ`);
        const errors = audit.filter(a => a.level === "error");
        if (errors.length > 0) toast.error(errors.map(e => e.message).join("\n"));
        else toast.success(tf("inspector.okBatchDeleted", { n: selectedCells.size }));
        setReason("");
        clearSelectedCells();
        setMultiSelectMode(false);
      });
    } else if (multiOpMode === "add") {
      const targetClass = newClass || (isHomeroomMode ? (homeroomClass ?? null) : null);
      const targetSubject = newSubject || null;
      if (!targetClass && !targetSubject) {
        toast.error(t("inspector.errClassOrSubject"));
        return;
      }
      const ops = parsedSelectedCells.flatMap(({ date, period }) => {
        const slot = entryByDate.get(date)?.periods.find(p => p.period === period);
        if (targetClass && targetSubject) {
          return [buildAddOp(date, period, targetClass, reason || undefined, targetSubject)];
        } else if (targetClass) {
          return [buildAddOp(date, period, targetClass, reason || undefined, undefined)];
        } else {
          return [buildSetSubjectOp(date, period, slot?.class ?? null, targetSubject)];
        }
      });
      const displayLabel = [targetClass, targetSubject].filter(Boolean).join(' / ');
      const preview: ChangePreview = {
        opType: "add",
        description: tf("inspector.batchAddDesc", { n: selectedCells.size }),
        items: parsedSelectedCells.map(({ date, period }) => {
          const slot = entryByDate.get(date)?.periods.find(p => p.period === period);
          return {
            label: pLabel(date, period),
            fromDate: date, fromPeriod: period, fromClass: slot?.class ?? null,
            toDate: date, toPeriod: period, toClass: targetClass,
          };
        }),
        warnings: [],
      };
      setConfirmPreview(preview);
      setConfirmOpen(true);
      setPendingExecute(() => () => {
        const audit = applyOps(ops, `一括追加: ${selectedCells.size}コマ → ${displayLabel}`);
        const errors = audit.filter(a => a.level === "error");
        if (errors.length > 0) toast.error(errors.map(e => e.message).join("\n"));
        else toast.success(tf("inspector.okBatchAdded", { n: selectedCells.size, label: displayLabel }));
        setNewClass(""); setNewSubject(""); setReason("");
        clearSelectedCells();
        setMultiSelectMode(false);
      });
    } else if (multiOpMode === "reason") {
      if (!reason) { toast.error(t("inspector.errEnterReason")); return; }
      const ops = parsedSelectedCells.map(({ date, period }) => buildReasonOp(date, period, reason));
      const preview: ChangePreview = {
        opType: "add",
        description: tf("inspector.batchReasonDesc", { n: selectedCells.size }),
        items: parsedSelectedCells.map(({ date, period }) => {
          const slot = entryByDate.get(date)?.periods.find(p => p.period === period);
          return {
            label: pLabel(date, period),
            fromDate: date, fromPeriod: period, fromClass: slot?.class ?? null,
            toDate: date, toPeriod: period, toClass: slot?.class ?? null, toReason: reason,
          };
        }),
        warnings: [],
      };
      setConfirmPreview(preview);
      setConfirmOpen(true);
      setPendingExecute(() => () => {
        applyOps(ops, `一括理由設定: ${selectedCells.size}コマ → ${reason}`);
        toast.success(tf("inspector.okBatchReason", { n: selectedCells.size }));
        setReason("");
        clearSelectedCells();
        setMultiSelectMode(false);
      });
    } else if (multiOpMode === "subject") {
      const subjectValue = newSubject || null;
      const ops = parsedSelectedCells.map(({ date, period }) => {
        const slot = entryByDate.get(date)?.periods.find(p => p.period === period);
        return buildSetSubjectOp(date, period, slot?.class ?? null, subjectValue);
      });
      const preview: ChangePreview = {
        opType: "add",
        description: tf("inspector.batchSubjectDesc", { n: selectedCells.size }),
        items: parsedSelectedCells.map(({ date, period }) => {
          const slot = entryByDate.get(date)?.periods.find(p => p.period === period);
          return {
            label: pLabel(date, period),
            fromDate: date, fromPeriod: period, fromClass: slot?.class ?? null,
            toDate: date, toPeriod: period, toClass: slot?.class ?? null,
          };
        }),
        warnings: [],
      };
      setConfirmPreview(preview);
      setConfirmOpen(true);
      setPendingExecute(() => () => {
        applyOps(ops, `一括教科設定: ${selectedCells.size}コマ → ${subjectValue ?? "なし"}`);
        toast.success(subjectValue
          ? tf("inspector.okBatchSubjectSet", { n: selectedCells.size, label: subjectValue })
          : tf("inspector.okBatchSubjectDeleted", { n: selectedCells.size }));
        setNewSubject("");
        clearSelectedCells();
        setMultiSelectMode(false);
      });
    }
  };

  // ─── 単一選択モードの操作 ──────────────────────────────────────
  const handleExecute = () => {
    if (!selectedCell) return;
    if (opMode === "delete") {
      const op = buildDeleteOp(date, period, currentClass, reason || undefined);
      const v = validateOp(op);
      if (!v.valid) { toast.error(v.errors.join("\n")); return; }
      const preview: ChangePreview = {
        opType: "delete",
        description: tf("inspector.descDelete", { d: pLabel(date, period) }),
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
        else toast.success(tf("inspector.okDeleted", { d: pLabel(date, period) }));
        setReason("");
      });
    } else if (opMode === "add") {
      // 全モード共通: クラスと教科を独立に設定できる
      // homeroomモード: newClassが空の場合はhomeroomClassを使用
      const targetClass = newClass || (isHomeroomMode ? (homeroomClass ?? null) : null);
      const targetSubject = newSubject || null;
      // クラスも教科もない場合はエラー
      if (!targetClass && !targetSubject) {
        toast.error(t("inspector.errClassOrSubject"));
        return;
      }
      let op;
      if (targetClass && targetSubject) {
        // クラスと教科両方設定
        op = buildAddOp(date, period, targetClass, reason || undefined, targetSubject);
      } else if (targetClass) {
        // クラスのみ
        op = buildAddOp(date, period, targetClass, reason || undefined, undefined);
      } else {
        // 教科のみ（クラスなし）
        op = buildSetSubjectOp(date, period, currentClass, targetSubject);
      }
      const v = validateOp(op);
      if (!v.valid) { toast.error(v.errors.join("\n")); return; }
      const displayLabel = [targetClass, targetSubject].filter(Boolean).join(' / ');
      const preview: ChangePreview = {
        opType: "add",
        description: tf("inspector.descAdd", { d: pLabel(date, period) }),
        items: [{
          label: "",
          fromDate: date, fromPeriod: period, fromClass: currentClass,
          toDate: date, toPeriod: period, toClass: targetClass, toReason: reason || undefined,
        }],
        warnings: v.warnings,
      };
      showConfirm("add", `追加: ${date} ${period}限 → ${displayLabel}`, preview, () => {
        const audit = applyOps([op], `追加: ${date} ${period}限 → ${displayLabel}`);
        const errors = audit.filter(a => a.level === "error");
        if (errors.length > 0) toast.error(errors.map(e => e.message).join("\n"));
        else toast.success(tf("inspector.okAdded", { label: displayLabel }));
        setNewClass(""); setNewSubject(""); setReason("");
      });
    } else if (opMode === "move") {
      if (!dstDate) { toast.error(t("inspector.errSelectMoveDate")); return; }
      const dstSlot = entryByDate.get(dstDate)?.periods.find(p => p.period === Number(dstPeriod));
      const ops = buildMoveOps(date, period, currentClass, dstDate, Number(dstPeriod), dstSlot?.class ?? null, reason || undefined, currentSubject);
      const preview: ChangePreview = {
        opType: "move",
        description: tf("inspector.descMove", { from: pLabel(date, period), to: pLabel(dstDate, dstPeriod) }),
        items: [
          {
            label: t("inspector.moveFrom"),
            fromDate: date, fromPeriod: period, fromClass: currentClass,
            toDate: date, toPeriod: period, toClass: null,
          },
          {
            label: t("inspector.moveTo"),
            fromDate: dstDate, fromPeriod: Number(dstPeriod), fromClass: dstSlot?.class ?? null,
            toDate: dstDate, toPeriod: Number(dstPeriod), toClass: currentClass, toReason: reason || undefined,
          },
        ],
        warnings: dstSlot?.class ? [tf("inspector.moveOverwriteWarn", { to: pLabel(dstDate, dstPeriod), c: dstSlot.class })] : [],
      };
      showConfirm("move", `移動: ${date} ${period}限 → ${dstDate} ${dstPeriod}限`, preview, () => {
        const audit = applyOps(ops, `移動: ${date} ${period}限 → ${dstDate} ${dstPeriod}限`);
        const errors = audit.filter(a => a.level === "error");
        if (errors.length > 0) toast.error(errors.map(e => e.message).join("\n"));
        else toast.success(t("inspector.okMoved"));
        setReason("");
      });
    } else if (opMode === "swap") {
      if (!swapDate) { toast.error(t("inspector.errSelectSwapDate")); return; }
      const swapSlot = entryByDate.get(swapDate)?.periods.find(p => p.period === Number(swapPeriod));
      const ops = buildSwapOps(date, period, currentClass, swapDate, Number(swapPeriod), swapSlot?.class ?? null, reason || undefined, currentSubject, swapSlot?.subject);
      const preview: ChangePreview = {
        opType: "swap",
        description: tf("inspector.descSwap", { a: pLabel(date, period), b: pLabel(swapDate, swapPeriod) }),
        items: [
          {
            label: pLabel(date, period),
            fromClass: currentClass,
            toClass: swapSlot?.class ?? null,
          },
          {
            label: pLabel(swapDate, swapPeriod),
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
        else toast.success(t("inspector.okSwapped"));
      });
    } else if (opMode === "reason") {
      if (!reason) { toast.error(t("inspector.errEnterReason")); return; }
      const ops = [buildReasonOp(date, period, reason)];
      const preview: ChangePreview = {
        opType: "add",
        description: tf("inspector.descReason", { d: pLabel(date, period) }),
        items: [{
          label: "",
          fromDate: date, fromPeriod: period, fromClass: currentClass, fromReason: currentSlot?.reason,
          toDate: date, toPeriod: period, toClass: currentClass, toReason: reason,
        }],
        warnings: [],
      };
      showConfirm("add", `理由設定: ${date} ${period}限`, preview, () => {
        applyOps(ops, `理由設定: ${date} ${period}限`);
        toast.success(t("inspector.okReasonSet"));
        setReason("");
      });
    } else if (opMode === "subject") {
      // 教科のみ変更（クラスは維持）
      const subjectValue = newSubject || null;
      const op = buildSetSubjectOp(date, period, currentClass, subjectValue);
      const preview: ChangePreview = {
        opType: "add",
        description: tf("inspector.descSubject", { d: pLabel(date, period) }),
        items: [{
          label: "",
          fromDate: date, fromPeriod: period, fromClass: currentClass,
          toDate: date, toPeriod: period, toClass: currentClass,
        }],
        warnings: [],
      };
      showConfirm("add", `教科設定: ${date} ${period}限 → ${subjectValue ?? "なし"}`, preview, () => {
        applyOps([op], `教科設定: ${date} ${period}限 → ${subjectValue ?? "なし"}`);
        toast.success(subjectValue ? tf("inspector.okSubjectSet", { label: subjectValue }) : t("inspector.okSubjectDeleted"));
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
    { id: "delete", label: t("inspector.opDelete") },
    { id: "add", label: t("inspector.opAdd") },
    { id: "move", label: t("inspector.opMove") },
    { id: "swap", label: t("inspector.opSwap") },
    { id: "reason", label: t("inspector.opReason") },
    ...(showSubjectOp ? [{ id: "subject" as OpMode, label: t("inspector.opSubject") }] : []),
  ];

  const multiOpModes: { id: MultiOpMode; label: string }[] = [
    { id: "delete", label: t("inspector.opDelete") },
    { id: "add", label: t("inspector.opAdd") },
    { id: "reason", label: t("inspector.opReason") },
    ...(showSubjectOp ? [{ id: "subject" as MultiOpMode, label: t("inspector.opSubject") }] : []),
  ];

  // 追加モードの初期クラス値: homeroomモードは担任クラスをデフォルトに設定
  const defaultAddClass = isHomeroomMode ? (homeroomClass ?? "") : "";

  // ─── 複数選択モードのパネル ────────────────────────────────────
  if (multiSelectMode) {
    return (
      <>
        {/* Mobile: bottom sheet overlay */}
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMultiSelectMode(false)}
        />
        {/* Panel */}
        <div className="
          fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl shadow-2xl
          lg:static lg:w-[260px] lg:shrink-0 lg:rounded-none lg:shadow-none lg:z-auto
          border-t lg:border-t-0 lg:border-l border-border
          flex flex-col bg-card
          animate-in slide-in-from-bottom lg:slide-in-from-right duration-200
          max-h-[85vh] lg:max-h-full lg:h-full lg:overflow-hidden
        ">
          {/* Mobile drag handle */}
          <div className="flex justify-center pt-2 pb-1 lg:hidden">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-amber-50/50">
            <div className="flex items-center gap-2">
              <CheckSquare size={14} className="text-amber-600" />
              <div>
                <p className="text-xs text-amber-600 font-medium">{t("inspector.multiSelectMode")}</p>
                <p className="text-sm font-bold text-foreground">
                  {selectedCells.size > 0 ? tf("inspector.nSelected", { n: selectedCells.size }) : t("inspector.selectPeriodsPrompt")}
                </p>
              </div>
            </div>
            <button
              onClick={() => setMultiSelectMode(false)}
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted transition-colors"
            >
              <X size={13} className="text-muted-foreground" />
            </button>
          </div>

          {/* 選択コマ一覧（最大5件表示） */}
          {selectedCells.size > 0 && (
            <div className="px-4 py-2 border-b border-border bg-muted/20">
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {parsedSelectedCells.slice(0, 5).map(({ date, period }) => {
                  const slot = entryByDate.get(date)?.periods.find(p => p.period === period);
                  return (
                    <div key={`${date}|${period}`} className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground">{pLabel(date, period)}</span>
                      <span className="font-medium text-foreground">{slot?.class ?? t("inspector.empty")}</span>
                      {slot?.subject && <span className="text-muted-foreground">/ {slot.subject}</span>}
                    </div>
                  );
                })}
                {selectedCells.size > 5 && (
                  <div className="text-[10px] text-muted-foreground">{tf("inspector.othersCount", { n: selectedCells.size - 5 })}</div>
                )}
              </div>
              <button
                onClick={() => clearSelectedCells()}
                className="mt-1 text-[10px] text-muted-foreground hover:text-foreground underline"
              >
                {t("inspector.clearAll")}
              </button>
            </div>
          )}

          {/* Op mode tabs */}
          <div className="px-3 pt-3">
            <div className="flex gap-1 flex-wrap">
              {multiOpModes.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMultiOpMode(m.id)}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors border",
                    multiOpMode === m.id
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
            {multiOpMode === "delete" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{tf("inspector.batchDeleteDesc", { n: selectedCells.size })}</p>
                <ReasonField reason={reason} setReason={setReason} />
              </div>
            )}
            {multiOpMode === "add" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{tf("inspector.batchAddDesc", { n: selectedCells.size })}</p>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    {t("inspector.classLabel")}
                    {isHomeroomMode && <span className="ml-1 text-[10px] text-amber-600">{tf("inspector.homeroomHint", { c: homeroomClass ?? t("inspector.notSet") })}</span>}
                  </Label>
                  <Select
                    value={newClass || (isHomeroomMode ? (homeroomClass ?? "__none__") : "__none__")}
                    onValueChange={v => setNewClass(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder={t("inspector.selectClassPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">{t("inspector.noneSelectable")}</span>
                      </SelectItem>
                      {effectiveClassList.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <SubjectField
                  value={newSubject}
                  onChange={setNewSubject}
                  subjects={subjects.map(s => s.name)}
                  required={isHomeroomMode && !newClass && !homeroomClass}
                  allowEmpty
                  emptyLabel={t("inspector.notSpecified")}
                />
                <ReasonField reason={reason} setReason={setReason} />
              </div>
            )}
            {multiOpMode === "reason" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{tf("inspector.batchReasonDesc", { n: selectedCells.size })}</p>
                <ReasonField reason={reason} setReason={setReason} required />
              </div>
            )}
            {multiOpMode === "subject" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{tf("inspector.batchSubjectDesc", { n: selectedCells.size })}</p>
                <SubjectField
                  value={newSubject}
                  onChange={setNewSubject}
                  subjects={subjects.map(s => s.name)}
                  allowEmpty
                  emptyLabel={t("inspector.subjectNoneDelete")}
                />
              </div>
            )}
          </div>

          {/* Execute button */}
          <div className="px-4 py-3 border-t border-border">
            <Button
              className="w-full h-9 text-sm font-medium"
              disabled={selectedCells.size === 0}
              onClick={handleMultiExecute}
            >
              {multiOpMode === "delete" && tf("inspector.execDelete", { n: selectedCells.size })}
              {multiOpMode === "add" && tf("inspector.execAdd", { n: selectedCells.size })}
              {multiOpMode === "reason" && tf("inspector.execReason", { n: selectedCells.size })}
              {multiOpMode === "subject" && tf("inspector.execSubject", { n: selectedCells.size })}
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

  // ─── 単一選択モード（従来通り） ───────────────────────────────
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
            <p className="text-xs text-muted-foreground">{t("inspector.selectedCell")}</p>
            <p className="text-sm font-bold text-foreground">
              {formatDateJP(date)} — {period}{t("audit.periodSuffix")}
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
                      : <span className="text-muted-foreground font-normal">{t("inspector.noClass")}</span>
                  }
                </p>
              ) : (
                <>
                  <p className="text-sm font-semibold" style={currentClass ? { color: cellColors?.text } : {}}>
                    {currentClass ?? <span className="text-muted-foreground font-normal">{t("inspector.noClass")}</span>}
                  </p>
                  {currentSubject && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{tf("inspector.subjectPrefix", { s: currentSubject })}</p>
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
                    ? (currentSubject ?? currentClass ?? t("inspector.emptyPeriod"))
                    : (currentClass ?? t("inspector.emptyPeriod"))
                  }
                </span> {t("inspector.deleteTargetSuffix")}
              </p>
              <ReasonField reason={reason} setReason={setReason} />
            </div>
          )}

          {/* Add mode: 全モードでクラス欄と教科欄を表示 */}
          {opMode === "add" && (
            <div className="space-y-2">
              {/* Class field: 全モードで表示。homeroomモードは担任クラスをデフォルトに設定 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  {t("inspector.classLabel")}
                  {isHomeroomMode && <span className="ml-1 text-[10px] text-amber-600">{tf("inspector.homeroomHint", { c: homeroomClass ?? t("inspector.notSet") })}</span>}
                </Label>
                <Select
                  value={newClass || (isHomeroomMode ? (homeroomClass ?? "__none__") : "__none__")}
                  onValueChange={v => setNewClass(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder={t("inspector.selectClassBlankHint")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">{t("inspector.noneSelectable")}</span>
                    </SelectItem>
                    {effectiveClassList.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Subject field: 全モードで表示（教科リストがある場合） */}
              <SubjectField
                value={newSubject}
                onChange={setNewSubject}
                subjects={subjects.map(s => s.name)}
                required={isHomeroomMode && !newClass && !homeroomClass}
                allowEmpty
                emptyLabel={t("inspector.notSpecified")}
              />
              <ReasonField reason={reason} setReason={setReason} />
            </div>
          )}

          {/* Move mode */}
          {opMode === "move" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("inspector.specifyMoveDest")}</p>
              <DatePeriodPicker
                label={t("inspector.moveTo")}
                dates={availableDates}
                date={dstDate} setDate={setDstDate}
                period={dstPeriod} setPeriod={setDstPeriod}
              />
              {dstDate && dstPeriod && (() => {
                const dstSlot = entryByDate.get(dstDate)?.periods.find(p => p.period === Number(dstPeriod));
                return dstSlot?.class ? (
                  <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700">
                    {tf("inspector.moveDestOccupied", { c: dstSlot.class })}
                  </div>
                ) : null;
              })()}
              <ReasonField reason={reason} setReason={setReason} />
            </div>
          )}

          {/* Swap mode */}
          {opMode === "swap" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("inspector.specifySwapDest")}</p>
              <DatePeriodPicker
                label={t("inspector.swapTo")}
                dates={availableDates}
                date={swapDate} setDate={setSwapDate}
                period={swapPeriod} setPeriod={setSwapPeriod}
              />
              {swapDate && swapPeriod && (
                <div className="bg-muted/50 rounded p-2 text-xs text-muted-foreground">
                  {t("inspector.swapTo")}: <span className="font-medium text-foreground">
                    {entryByDate.get(swapDate)?.periods.find(p => p.period === Number(swapPeriod))?.class ?? t("inspector.empty")}
                  </span>
                </div>
              )}
              <ReasonField reason={reason} setReason={setReason} />
            </div>
          )}

          {/* Reason mode */}
          {opMode === "reason" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("inspector.reasonOverwriteNote")}</p>
              <ReasonField reason={reason} setReason={setReason} required />
            </div>
          )}

          {/* Subject mode */}
          {opMode === "subject" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("inspector.setSubjectForCell")}
                {currentSubject && <span className="ml-1">{tf("inspector.currentSubjectHint", { s: currentSubject })}</span>}
              </p>
              <SubjectField
                value={newSubject}
                onChange={setNewSubject}
                subjects={subjects.map(s => s.name)}
                allowEmpty
                emptyLabel={t("inspector.subjectNoneDelete")}
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
            {opMode === "delete" && t("inspector.confirmDelete")}
            {opMode === "add" && t("inspector.confirmAdd")}
            {opMode === "move" && t("inspector.confirmMove")}
            {opMode === "swap" && t("inspector.confirmSwap")}
            {opMode === "reason" && t("inspector.confirmReason")}
            {opMode === "subject" && t("inspector.confirmSubject")}
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
  const { t } = useLanguage();
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">
        {t("inspector.reasonField")}{required ? " *" : ` ${t("inspector.optional")}`}
      </Label>
      <div className="space-y-1.5">
        <Input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={t("inspector.reasonPlaceholder")}
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
  value, onChange, subjects, required = false, allowEmpty = false, emptyLabel
}: {
  value: string;
  onChange: (v: string) => void;
  subjects: string[];
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">
        {t("inspector.subjectField")}{required ? " *" : ` ${t("inspector.optional")}`}
      </Label>
      <Select value={value || (allowEmpty ? "__none__" : "")} onValueChange={v => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder={t("inspector.selectSubjectPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty && (
            <SelectItem value="__none__">{emptyLabel ?? t("inspector.subjectNone")}</SelectItem>
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
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">{t("inspector.dateOf").split("{label}").join(label)}</Label>
        <Select value={date} onValueChange={setDate}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={t("inspector.selectDatePlaceholder")} />
          </SelectTrigger>
          <SelectContent className="max-h-48">
            {dates.map(d => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">{t("inspector.periodOf").split("{label}").join(label)}</Label>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6].map(p => (
              <SelectItem key={p} value={String(p)}>{p}{t("audit.periodSuffix")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
