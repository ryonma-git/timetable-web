// TeachingPlanView.tsx
// 指導計画画面：時間割から学年×教科を自動抽出し、一覧+テーブルで管理

import { useState, useMemo, useCallback, useEffect, useRef, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { useTimetable } from "@/contexts/TimetableContext";
import { GradeSubjectPlan, TeachingUnit, LessonPlanEntry, ClassLessonOverride } from "@/lib/timetableFile";
import { TimetableEntry } from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, BookOpen, ChevronDown, ChevronRight, Pencil, Check, X, GripVertical, FileText, Ban, AlertTriangle, Eye, EyeOff, FileSpreadsheet, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { exportTeachingPlansToExcel, importTeachingPlansFromExcel } from "@/lib/teachingPlanExcel";
import { TeachingPlanTemplateDialog } from "@/components/TeachingPlanTemplateDialog";
import { BookMarked } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useLanguage, type TranslationKey } from "@/contexts/LanguageContext";

type TFn = (k: TranslationKey) => string;
// {token} を変数で置換（t()は補間非対応）
function tpf(t: TFn, key: TranslationKey, vars: Record<string, string | number>): string {
  let s: string = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// ─── 計算ロジック ─────────────────────────────────────────────

function computeClassLessonSlots(
  effectiveEntries: TimetableEntry[],
  targetClass: string,
  targetSubject: string,
): Array<{ date: string; period: number; weekday_jp: string }> {
  const slots: Array<{ date: string; period: number; weekday_jp: string }> = [];
  for (const entry of effectiveEntries) {
    for (const slot of entry.periods) {
      if (slot.class === targetClass && slot.subject === targetSubject) {
        slots.push({ date: entry.date, period: slot.period, weekday_jp: entry.weekday_jp });
      }
    }
  }
  slots.sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  return slots;
}

function extractGradeSubjectCombos(
  effectiveEntries: TimetableEntry[],
): Array<{ grade: string; subject: string; classes: string[] }> {
  const map = new Map<string, Set<string>>();
  for (const entry of effectiveEntries) {
    for (const slot of entry.periods) {
      if (!slot.class || !slot.subject) continue;
      const gradeMatch = slot.class.match(/^(\d+)年/);
      if (!gradeMatch) continue;
      const grade = `${gradeMatch[1]}年`;
      const key = `${grade}|||${slot.subject}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(slot.class);
    }
  }
  return Array.from(map.entries())
    .map(([key, classes]) => {
      const [grade, subject] = key.split("|||");
      return { grade, subject, classes: Array.from(classes).sort() };
    })
    .sort((a, b) => a.grade.localeCompare(b.grade) || a.subject.localeCompare(b.subject));
}

// ─── v104 Phase B: クラス×教科の進捗を計算する純関数 ───────────────
// PlanTableのロジック（plannedRows + classRowSlotMap + 内容解決）を再利用可能に抽出

export type ClassPlanRowStatus = "past" | "today" | "next" | "future" | "overflow" | "none";

export interface ClassPlanRow {
  n: number;                  // 1-based 計画行
  unitName: string;
  unitColorIdx: number;
  content: string;            // 実効内容（lesson上書き → 単元マスター → 空）
  unitPeriod: number;
  slot?: { date: string; period: number; weekday_jp: string };
  status: ClassPlanRowStatus;
  delayed: boolean;
  advanced: boolean;
}

export interface ClassPlanProgress {
  rows: ClassPlanRow[];
  totalSlots: number;
  completedCount: number;
  currentRow?: ClassPlanRow;  // 直近完了（過去の最後）
  todayRows: ClassPlanRow[];
  nextRow?: ClassPlanRow;     // 今日 or 次回の最初
  hasOverflow: boolean;
}

export function computeClassPlanProgress(
  plan: GradeSubjectPlan,
  cls: string,
  effectiveEntries: TimetableEntry[],
  asOf: string,
): ClassPlanProgress {
  const slots = computeClassLessonSlots(effectiveEntries, cls, plan.subject);

  // 計画レイアウト（単元順 × plannedPeriods）
  const plannedRows: Array<{ unitId: string; unitPeriod: number }> = [];
  for (const unit of plan.units) {
    const periods = Math.max(0, unit.plannedPeriods || 0);
    for (let i = 0; i < periods; i++) plannedRows.push({ unitId: unit.id, unitPeriod: i + 1 });
  }
  const unitIndexMap = new Map<string, number>();
  plan.units.forEach((u, i) => unitIndexMap.set(u.id, i));

  const maxSlots = Math.max(plan.lessons.length, slots.length, plannedRows.length, 0);

  // 行→スロットindex（delayed=2スロット消費 / advanced=前行と同日）
  const rowSlot = new Map<number, number>();
  const overflowSet = new Set<number>();
  {
    let slotIdx = 0;
    let lastSlotIdx = -1;
    for (let row = 1; row <= maxSlots; row++) {
      const ov = plan.lessons[row - 1]?.classOverrides?.[cls];
      const delayed = ov?.delayed ?? false;
      const advanced = ov?.advanced ?? false;
      if (advanced && !delayed && lastSlotIdx >= 0) {
        rowSlot.set(row, lastSlotIdx);
        continue;
      }
      if (delayed) slotIdx += 1;
      if (slotIdx < slots.length) {
        rowSlot.set(row, slotIdx);
        lastSlotIdx = slotIdx;
      } else if (slots.length > 0) {
        overflowSet.add(row);
      }
      slotIdx += 1;
    }
  }

  const unitCounts = new Map<string, number>();
  const rows: ClassPlanRow[] = [];
  let completedCount = 0;
  const todayRows: ClassPlanRow[] = [];
  let nextRow: ClassPlanRow | undefined;
  let currentRow: ClassPlanRow | undefined;

  for (let i = 0; i < maxSlots; i++) {
    const n = i + 1;
    const entry = plan.lessons[i] ?? null;
    const plannedSlot = plannedRows[i] ?? null;
    const overrideUnitId = entry?.unitId ?? "";
    const effectiveUnitId = overrideUnitId || (plannedSlot?.unitId ?? "");
    const unit = effectiveUnitId ? (plan.units.find(u => u.id === effectiveUnitId) ?? null) : null;
    const unitColorIdx = unit ? (unitIndexMap.get(unit.id) ?? 0) : 0;

    let unitPeriod = 0;
    if (effectiveUnitId) {
      const c = (unitCounts.get(effectiveUnitId) ?? 0) + 1;
      unitCounts.set(effectiveUnitId, c);
      unitPeriod = c;
    }
    let content = entry?.content ?? "";
    if (!content && unit && unitPeriod > 0) {
      content = unit.lessons?.find(l => l.period === unitPeriod)?.content ?? "";
    }

    const ov = entry?.classOverrides?.[cls];
    const delayed = !!ov?.delayed;
    const advanced = !!ov?.advanced && !delayed;
    if (ov?.content) content = ov.content;

    const sIdx = rowSlot.get(n);
    const slot = sIdx !== undefined ? slots[sIdx] : undefined;
    const isOverflow = overflowSet.has(n);

    let status: ClassPlanRowStatus = "none";
    if (slot) {
      if (slot.date < asOf) status = "past";
      else if (slot.date === asOf) status = "today";
      else status = "future";
    } else if (isOverflow) {
      status = "overflow";
    }

    const r: ClassPlanRow = {
      n, unitName: unit?.name ?? "", unitColorIdx, content, unitPeriod,
      slot, status, delayed, advanced,
    };
    rows.push(r);

    if (status === "past") { completedCount++; currentRow = r; }
    else if (status === "today") { todayRows.push(r); }
  }
  // 次回 = 今日の最初 → なければ最初のfuture
  nextRow = todayRows[0] ?? rows.find(r => r.status === "future");

  return {
    rows,
    totalSlots: slots.length,
    completedCount,
    currentRow,
    todayRows,
    nextRow,
    hasOverflow: overflowSet.size > 0,
  };
}

// ─── 単元カラーパレット ───────────────────────────────────────
const UNIT_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-green-100 text-green-800 border-green-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-orange-100 text-orange-800 border-orange-200",
  "bg-teal-100 text-teal-800 border-teal-200",
];

function getUnitColor(idx: number) {
  return UNIT_COLORS[idx % UNIT_COLORS.length];
}

// ─── 単元セル（インライン選択） ────────────────────────────────

interface UnitCellProps {
  unit: TeachingUnit | null;
  units: TeachingUnit[];
  unitColorIdx: number;
  onSelect: (unitId: string) => void;
  disabled?: boolean;
  isFromPlan?: boolean;   // trueなら自動計画から割り当てた行
}

function UnitCell({ unit, units, unitColorIdx, onSelect, disabled, isFromPlan }: UnitCellProps) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();

  if (disabled) {
    return <span className="text-[10px] text-muted-foreground/30 italic">{t("tp.notHeld")}</span>;
  }

  if (open) {
    return (
      <select
        autoFocus
        className="w-full text-xs border border-border rounded px-1 py-0.5 bg-background"
        value={unit?.id ?? ""}
        onChange={e => { onSelect(e.target.value); setOpen(false); }}
        onBlur={() => setOpen(false)}
      >
        <option value="">{t("tp.noneBackToPlan")}</option>
        {units.map(u => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    );
  }

  return (
    <button
      className="text-left w-full group/unit"
      onClick={() => setOpen(true)}
      title={isFromPlan ? t("tp.unitCellAuto") : t("tp.unitCellClick")}
    >
      {unit ? (
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded border font-medium",
          getUnitColor(unitColorIdx),
          isFromPlan && "border-dashed opacity-70",
        )}>
          {unit.name}
          {isFromPlan && <span className="ml-0.5 text-[8px] opacity-50">{t("tp.planMark")}</span>}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/40 italic group-hover/unit:text-muted-foreground">
          {t("tp.setUnit")}
        </span>
      )}
    </button>
  );
}

// ─── 単元編集パネル ────────────────────────────────────────────

interface UnitEditorProps {
  units: TeachingUnit[];
  onChange: (units: TeachingUnit[]) => void;
}

function UnitEditor({ units, onChange }: UnitEditorProps) {
  const { t } = useLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPeriods, setEditPeriods] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null); // v94: 単元マスター展開

  const startEdit = (u: TeachingUnit) => {
    setEditingId(u.id);
    setEditName(u.name);
    setEditPeriods(String(u.plannedPeriods));
  };

  const commitEdit = (id: string) => {
    const p = parseInt(editPeriods);
    if (!editName.trim() || isNaN(p) || p < 1) return;
    onChange(units.map(u => u.id === id ? { ...u, name: editName.trim(), plannedPeriods: p } : u));
    setEditingId(null);
  };

  const addUnit = () => {
    const newUnit: TeachingUnit = { id: nanoid(8), name: t("tp.newUnit"), plannedPeriods: 4 };
    onChange([...units, newUnit]);
    setTimeout(() => startEdit(newUnit), 50);
  };

  // v94: 単元マスターの個別時間の内容を更新
  const updateUnitLesson = (unitId: string, period: number, content: string) => {
    onChange(units.map(u => {
      if (u.id !== unitId) return u;
      const lessons = u.lessons ? [...u.lessons] : [];
      const idx = lessons.findIndex(l => l.period === period);
      const trimmed = content;  // 空でも保持（編集中の空状態を許容）
      if (idx >= 0) {
        if (trimmed) {
          lessons[idx] = { ...lessons[idx], content: trimmed };
        } else {
          lessons.splice(idx, 1);
        }
      } else if (trimmed) {
        lessons.push({ period, content: trimmed });
        lessons.sort((a, b) => a.period - b.period);
      }
      return { ...u, lessons: lessons.length > 0 ? lessons : undefined };
    }));
  };

  const totalPlanned = units.reduce((s, u) => s + (u.plannedPeriods || 0), 0);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border/50">
        <span className="text-[10px] text-muted-foreground">{t("tp.unitEditorHint")}</span>
        {totalPlanned > 0 && (
          <span className="text-[10px] font-medium text-primary shrink-0 ml-2">{tpf(t, "tp.totalKoma", { n: totalPlanned })}</span>
        )}
      </div>
      {units.map((u, idx) => {
        const isExpanded = expandedId === u.id;
        const filledCount = u.lessons?.filter(l => l.content && l.period <= u.plannedPeriods).length ?? 0;
        return (
          <div key={u.id} className="border-l-2 border-transparent">
            <div className="flex items-center gap-2 group">
              <button
                onClick={() => setExpandedId(isExpanded ? null : u.id)}
                className="text-muted-foreground/60 hover:text-foreground shrink-0 w-4 flex items-center justify-center"
                title={isExpanded ? t("tp.closeEdit") : t("tp.editUnitPeriods")}
              >
                {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0", getUnitColor(idx))}>
                {idx + 1}
              </span>
              {editingId === u.id ? (
                <>
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-6 text-xs flex-1" autoFocus
                    onKeyDown={e => { if (e.key === "Enter") commitEdit(u.id); if (e.key === "Escape") setEditingId(null); }} />
                  <Input value={editPeriods} onChange={e => setEditPeriods(e.target.value)} className="h-6 text-xs w-14" type="number" min={1} />
                  <span className="text-xs text-muted-foreground shrink-0">{t("tp.komaCountSuffix")}</span>
                  <button onClick={() => commitEdit(u.id)} className="text-green-600 hover:text-green-700"><Check size={12} /></button>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
                </>
              ) : (
                <>
                  <span className="text-xs flex-1 truncate cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : u.id)}>{u.name}</span>
                  <span className="text-[10px] font-medium text-primary shrink-0">{u.plannedPeriods}{t("tp.komaCountSuffix")}</span>
                  {filledCount > 0 && (
                    <span className="text-[9px] text-muted-foreground shrink-0">{tpf(t, "tp.filledCount", { n: filledCount })}</span>
                  )}
                  <button onClick={() => startEdit(u)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"><Pencil size={11} /></button>
                  <button onClick={() => onChange(units.filter(x => x.id !== u.id))} className="opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive"><Trash2 size={11} /></button>
                </>
              )}
            </div>

            {/* v94: 単元マスター展開UI - 各時間の予定内容 */}
            {isExpanded && (
              <div className="ml-9 mt-1 mb-2 space-y-0.5 border-l-2 border-muted/40 pl-2">
                <p className="text-[9px] text-muted-foreground/60 mb-0.5">{t("tp.unitMasterHint")}</p>
                {Array.from({ length: u.plannedPeriods }, (_, i) => {
                  const p = i + 1;
                  const lesson = u.lessons?.find(l => l.period === p);
                  return (
                    <div key={p} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground w-6 shrink-0">{tpf(t, "tp.periodNo", { p })}</span>
                      <Input
                        defaultValue={lesson?.content ?? ""}
                        placeholder={tpf(t, "tp.periodContentPlaceholder", { p })}
                        className="h-6 text-xs flex-1"
                        onBlur={e => {
                          const val = e.target.value;
                          if (val !== (lesson?.content ?? "")) {
                            updateUnitLesson(u.id, p, val);
                          }
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 mt-1" onClick={addUnit}>
        <Plus size={11} /> {t("tp.addUnit")}
      </Button>
    </div>
  );
}

// ─── クラス列セルのPopover（v97 Phase1: 遅延マーク・メモ） ──────────

interface ClassCellPopoverProps {
  cls: string;
  slot: { date: string; period: number; weekday_jp: string } | undefined;
  /** v99 Phase3: delayed時の繰越元スロット（進まなかった日） */
  delayedFromSlot?: { date: string; period: number; weekday_jp: string };
  isPast: boolean;
  isToday: boolean;
  isNext: boolean;
  isSkip: boolean;
  isDelayed: boolean;
  isAdvanced: boolean;
  isOverflow: boolean;
  hasNote: boolean;
  hasContentOv: boolean;
  hasAnyOverride: boolean;
  override: ClassLessonOverride | undefined;
  onSave: (next: ClassLessonOverride | null) => void;
}

function ClassCellPopover({
  cls, slot, delayedFromSlot, isPast, isToday, isNext, isSkip, isDelayed, isAdvanced, isOverflow, hasNote, hasContentOv, hasAnyOverride, override, onSave,
}: ClassCellPopoverProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [delayed, setDelayed] = useState(!!override?.delayed);
  const [advanced, setAdvanced] = useState(!!override?.advanced);
  const [note, setNote] = useState(override?.note ?? "");
  const [contentOv, setContentOv] = useState(override?.content ?? ""); // v102 Phase2

  // popover開閉時に現状値を読み直し
  useEffect(() => {
    if (open) {
      setDelayed(!!override?.delayed);
      setAdvanced(!!override?.advanced);
      setNote(override?.note ?? "");
      setContentOv(override?.content ?? "");
    }
  }, [open, override]);

  const commit = () => {
    const trimmedNote = note.trim();
    const trimmedContent = contentOv.trim();
    const next: ClassLessonOverride = {};
    if (delayed) next.delayed = true;
    else if (advanced) next.advanced = true;  // delayed優先・排他
    if (trimmedNote) next.note = trimmedNote;
    if (trimmedContent) next.content = trimmedContent; // v102 Phase2: クラス別の実施内容
    const hasAny = next.delayed || next.advanced || next.note || next.content;
    onSave(hasAny ? next : null);
    setOpen(false);
  };

  const clearAll = () => {
    setDelayed(false);
    setAdvanced(false);
    setNote("");
    setContentOv("");
    onSave(null);
    setOpen(false);
  };

  const dateLabel = slot ? `${slot.date.slice(5).replace("-", "/")} ${slot.weekday_jp}${slot.period}` : null;
  const fromLabel = delayedFromSlot
    ? `${delayedFromSlot.date.slice(5).replace("-", "/")} ${delayedFromSlot.weekday_jp}${delayedFromSlot.period}`
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-full py-1.5 px-1 rounded text-[10px] transition-colors hover:bg-muted/30 cursor-pointer",
            isSkip && "line-through text-muted-foreground/30",
          )}
          title={
            isOverflow
              ? tpf(t, "tp.overflowTip", { cls })
              : hasAnyOverride
              ? `${cls}: ${isDelayed && fromLabel ? tpf(t, "tp.behindToOverflow", { from: fromLabel, d: dateLabel ?? "" }) : isDelayed ? t("tp.behindLabel") : ""}${isAdvanced ? t("tp.advancedLabel") : ""}${hasContentOv ? `${tpf(t, "tp.unitMasterPrefix", { c: override?.content ?? "" })} ` : ""}${hasNote ? t("tp.noteExists") : ""}`
              : tpf(t, "tp.cellClickHint", { cls })}
        >
          {slot ? (
            isDelayed && fromLabel ? (
              /* v101: 進まなかった日(元) と 繰越先 を役割分けて縦併記 */
              <span className="flex flex-col items-center leading-none gap-px py-0.5">
                <span className="text-[8px] text-muted-foreground/50 line-through">{fromLabel}</span>
                <span className="text-[7px] text-orange-400 leading-none">{t("tp.behindArrow")}</span>
                <span className="inline-flex items-center gap-0.5 text-orange-700 font-semibold dark:text-orange-300">
                  <AlertTriangle size={8} className="text-orange-500 shrink-0" />
                  <span>{dateLabel}</span>
                  {hasContentOv && <span className="text-sky-500 text-[8px] shrink-0" title={t("tp.contentOverrideMark")}>◆</span>}
                  {hasNote && <Pencil size={7} className="text-muted-foreground/50 shrink-0" />}
                </span>
              </span>
            ) : (
            <span className={cn(
              "inline-flex items-center gap-0.5",
              isSkip ? "" :
              isAdvanced ? "text-sky-700 font-semibold dark:text-sky-300" :
              isPast ? "text-muted-foreground/60" :
              isToday ? "text-amber-700 font-semibold dark:text-amber-400" :
              isNext ? "text-green-700 font-semibold dark:text-green-400" :
              "text-foreground",
            )}>
              {isPast && !isAdvanced && <span className="text-emerald-500">✓</span>}
              {isToday && !isAdvanced && <span>▶</span>}
              {isNext && !isToday && !isAdvanced && <span className="text-green-500">→</span>}
              {isAdvanced && <span className="text-sky-500 shrink-0">⏩</span>}
              <span>{dateLabel}</span>
              {hasContentOv && <span className="text-sky-500 text-[9px] shrink-0" title={t("tp.contentOverrideMark")}>◆</span>}
              {hasNote && <Pencil size={8} className="text-muted-foreground/50 shrink-0" />}
            </span>
            )
          ) : isOverflow ? (
            <span className="inline-flex items-center gap-0.5 text-rose-600/80 dark:text-rose-400">
              <AlertTriangle size={9} className="shrink-0" />
              <span>{t("tp.overflow")}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="center" collisionPadding={12}>
        <div className="space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-border/40">
            <span className="text-xs font-semibold">{cls}</span>
            {dateLabel && <span className="text-[10px] text-muted-foreground">{dateLabel}</span>}
          </div>

          {/* v99 Phase3: 繰越情報 */}
          {isDelayed && fromLabel && (
            <div className="flex items-start gap-1.5 text-[10px] bg-orange-50 dark:bg-orange-950/30 rounded px-2 py-1.5 text-orange-700 dark:text-orange-300">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span>
                {tpf(t, "tp.carriedOverInfo", { from: fromLabel ?? "", to: dateLabel ?? "" })}
              </span>
            </div>
          )}

          {/* v100: 前倒し情報 */}
          {isAdvanced && !isDelayed && (
            <div className="flex items-start gap-1.5 text-[10px] bg-sky-50 dark:bg-sky-950/30 rounded px-2 py-1.5 text-sky-700 dark:text-sky-300">
              <span className="shrink-0">⏩</span>
              <span>
                {t("tp.advancedInfo")}
              </span>
            </div>
          )}

          {/* v100: 日程超過警告 */}
          {isOverflow && (
            <div className="flex items-start gap-1.5 text-[10px] bg-rose-50 dark:bg-rose-950/30 rounded px-2 py-1.5 text-rose-700 dark:text-rose-300">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span>
                {t("tp.overflowInfo")}
              </span>
            </div>
          )}

          {/* 進捗マーク（delayed / advanced は排他） */}
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={delayed}
              onChange={e => { setDelayed(e.target.checked); if (e.target.checked) setAdvanced(false); }}
              className="w-3.5 h-3.5"
            />
            <span className="flex items-center gap-1">
              <AlertTriangle size={11} className="text-orange-500" />
              {t("tp.behindCheckbox")}
            </span>
          </label>
          <p className="text-[9px] text-muted-foreground/70 ml-5 -mt-1">
            {t("tp.behindCheckboxHint")}
          </p>

          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={advanced}
              onChange={e => { setAdvanced(e.target.checked); if (e.target.checked) setDelayed(false); }}
              className="w-3.5 h-3.5"
            />
            <span className="flex items-center gap-1">
              <span className="text-sky-500">⏩</span>
              {t("tp.advancedCheckbox")}
            </span>
          </label>
          <p className="text-[9px] text-muted-foreground/70 ml-5 -mt-1">
            {t("tp.advancedCheckboxHint")}
          </p>

          {/* v102 Phase2: このクラスだけの実施内容（計画と違う内容をやった場合） */}
          <div className="pt-1">
            <Label className="text-[10px] text-muted-foreground">{t("tp.classOnlyContent")}</Label>
            <Input
              value={contentOv}
              onChange={e => setContentOv(e.target.value)}
              placeholder={t("tp.classOnlyContentPh")}
              className="h-7 text-xs mt-0.5"
              onKeyDown={e => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <p className="text-[9px] text-muted-foreground/60 mt-0.5">
              {t("tp.classContentEmptyHint")}
            </p>
          </div>

          {/* メモ */}
          <div className="pt-1">
            <Label className="text-[10px] text-muted-foreground">{t("tp.classNote")}</Label>
            <Input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t("tp.classNotePh")}
              className="h-7 text-xs mt-0.5"
              onKeyDown={e => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex gap-1 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-7 text-[11px] px-2">
                {t("tp.cancel")}
              </Button>
              <Button size="sm" onClick={commit} className="h-7 text-[11px] px-3">
                <Check size={11} className="mr-0.5" />{t("tp.save")}
              </Button>
            </div>
            {hasAnyOverride && (
              <Button variant="ghost" size="sm" onClick={clearAll}
                className="h-6 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10 self-start">
                <X size={10} className="mr-0.5" />{t("tp.clearAll")}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── レッスン行 ────────────────────────────────────────────────

interface LessonRowProps {
  lessonNumber: number;
  entry: LessonPlanEntry | null;
  unit: TeachingUnit | null;
  unitColorIdx: number;
  unitPeriod: number;
  effectiveUnitId: string;
  isFromPlan: boolean;
  planContent: string;
  units: TeachingUnit[];
  classSlots: Record<string, Array<{ date: string; period: number; weekday_jp: string }>>;
  classes: string[];
  isSkip: boolean;                // v96: 旧データのみ表示用（編集UI廃止）
  today: string;
  classProgress: Record<string, ClassProgress>;
  /** v99 Phase3: クラス毎の 計画行→実施スロットindex（delayed/advanced考慮） */
  classRowSlotMap: Record<string, Map<number, number>>;
  /** v100: クラス毎の 日程超過行（繰越で時間割範囲を超えた行） */
  classOverflowRows: Record<string, Set<number>>;
  onSave: (entry: LessonPlanEntry) => void;
  /** v97 Phase1: クラス別オーバーライドの保存 */
  onSaveClassOverride: (cls: string, override: ClassLessonOverride | null) => void;
}

function LessonRow({
  lessonNumber, entry, unit, unitColorIdx, unitPeriod, effectiveUnitId, isFromPlan, planContent, units,
  classSlots, classes, isSkip, today, classProgress, classRowSlotMap, classOverflowRows, onSave, onSaveClassOverride,
}: LessonRowProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(entry?.content ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  // v96: ホバー状態をReact stateで管理（再レンダリング時にCSS hoverが残留する問題の修正）
  const [rowHovered, setRowHovered] = useState(false);

  const commit = () => {
    onSave({
      id: entry?.id ?? nanoid(8),
      unitId: effectiveUnitId,   // 計画由来でも正しいunitIdを保存
      unitPeriod,
      content: content.trim(),
      notes: notes.trim() || undefined,
      isSkip: entry?.isSkip,
    });
    setEditing(false);
  };

  const cancel = () => {
    setContent(entry?.content ?? "");
    setNotes(entry?.notes ?? "");
    setEditing(false);
  };

  const handleUnitSelect = (unitId: string) => {
    onSave({
      id: entry?.id ?? nanoid(8),
      unitId,                    // "" = 計画に戻す
      unitPeriod,
      content: entry?.content ?? "",
      notes: entry?.notes,
      isSkip: entry?.isSkip,
    });
  };

  return (
    <tr
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      className={cn(
        "border-b border-border/40 transition-colors",
        isSkip ? "bg-muted/30 opacity-60" :
        isFromPlan ? "bg-blue-50/20 dark:bg-blue-950/10" :
        "",
        rowHovered && !isSkip && (isFromPlan ? "bg-blue-50/40" : "bg-muted/20"),
        editing && "bg-muted/30",
      )}
    >
      {/* No. セル */}
      <td className="px-1 py-1.5 text-center w-12 shrink-0 relative">
        <div className="flex flex-col items-center gap-0.5">
          <span
            className={cn(
              "text-xs font-mono w-6 h-5 rounded flex items-center justify-center",
              isSkip ? "bg-muted text-muted-foreground line-through" : "text-muted-foreground"
            )}
          >
            {isSkip ? <Ban size={10} /> : lessonNumber}
          </span>
        </div>
      </td>

      {/* 単元セル */}
      <td className="px-2 py-1.5 w-32">
        <UnitCell
          unit={unit}
          units={units}
          unitColorIdx={unitColorIdx}
          onSelect={handleUnitSelect}
          disabled={isSkip}
          isFromPlan={isFromPlan}
        />
      </td>

      {/* 単元内 */}
      <td className="px-2 py-1.5 text-center text-xs text-muted-foreground w-10">
        {!isSkip && unit && unitPeriod > 0 ? unitPeriod : "—"}
      </td>

      {/* 内容予定 */}
      <td className="px-2 py-1.5 min-w-[160px]">
        {isSkip ? (
          <span className="text-xs text-muted-foreground italic">{t("tp.skipDesc")}</span>
        ) : editing ? (
          <div className="flex flex-col gap-1">
            <Input
              value={content}
              onChange={e => setContent(e.target.value)}
              className="h-6 text-xs"
              placeholder={planContent ? tpf(t, "tp.unitMasterPrefix", { c: planContent }) : t("tp.contentPlaceholder")}
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) commit(); if (e.key === "Escape") cancel(); }}
            />
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="h-5 text-[10px]"
              placeholder={t("tp.notesPlaceholder")}
            />
            <div className="flex gap-1">
              <button onClick={commit} className="text-green-600 hover:text-green-700 text-[10px] flex items-center gap-0.5"><Check size={10} />{t("tp.save")}</button>
              <button onClick={cancel} className="text-muted-foreground hover:text-foreground text-[10px] flex items-center gap-0.5"><X size={10} />{t("tp.cancelEdit")}</button>
            </div>
          </div>
        ) : (
          <div
            className="flex items-center gap-1 cursor-pointer min-h-[24px]"
            onClick={() => { setContent(entry?.content ?? ""); setNotes(entry?.notes ?? ""); setEditing(true); }}
            title={planContent && !entry?.content ? tpf(t, "tp.unitMasterClickOverride", { c: planContent }) : undefined}
          >
            {entry?.content ? (
              <span className="text-xs text-foreground">{entry.content}</span>
            ) : planContent ? (
              <span className="text-xs text-muted-foreground/60 italic">{planContent}</span>
            ) : (
              <span className="text-xs text-muted-foreground/40 italic">{t("tp.clickToInput")}</span>
            )}
            <Pencil size={10} className="opacity-0 group-hover/row:opacity-60 text-muted-foreground shrink-0" />
          </div>
        )}
      </td>

      {/* クラス別実施日（今日/次回/済み + v97: クラス別遅延マーク） */}
      {classes.map(cls => {
        const slots = classSlots[cls] ?? [];
        // v99 Phase3: delayed考慮の行→スロット対応で実施日を取得
        const sIdx = classRowSlotMap[cls]?.get(lessonNumber);
        const slot = sIdx !== undefined ? slots[sIdx] : undefined;
        const prog = classProgress[cls];
        const rowIdx = lessonNumber - 1; // 0-based
        const isPast = !!(!isSkip && slot && slot.date < today);
        const isToday = !!(!isSkip && slot && prog?.todayRowIndices.includes(rowIdx));
        const isNext = !!(!isSkip && !isToday && slot && prog?.nextRowIdx === rowIdx);
        // v97 Phase1: クラス別オーバーライド
        const override = entry?.classOverrides?.[cls];
        const isDelayed = !!override?.delayed;
        const isAdvanced = !!override?.advanced && !isDelayed;
        const hasContentOv = !!override?.content;
        const hasNote = !!override?.note;
        const hasAnyOverride = isDelayed || isAdvanced || hasNote || hasContentOv;
        // v99 Phase3: delayed時の「進まなかった元の日」（繰越前）
        const delayedFromSlot = isDelayed && sIdx !== undefined && sIdx > 0 ? slots[sIdx - 1] : undefined;
        // v100: 繰越で時間割範囲を超過した行
        const isOverflow = !isSkip && (classOverflowRows[cls]?.has(lessonNumber) ?? false);

        return (
          <td key={cls} className={cn(
            "px-1 py-0 text-center text-[10px] w-20 whitespace-nowrap transition-colors",
            isPast && !isDelayed && !isAdvanced && "bg-muted/20",
            isToday && !isDelayed && !isAdvanced && "bg-amber-50 dark:bg-amber-950/20",
            isNext && !isDelayed && !isAdvanced && "bg-green-50 dark:bg-green-950/20",
            isDelayed && "bg-orange-100/70 dark:bg-orange-900/30",
            isAdvanced && "bg-sky-100/70 dark:bg-sky-900/30",
            isOverflow && "bg-rose-50 dark:bg-rose-950/20",
          )}>
            <ClassCellPopover
              cls={cls}
              isAdvanced={isAdvanced}
              isOverflow={isOverflow}
              slot={slot}
              delayedFromSlot={delayedFromSlot}
              isPast={isPast}
              isToday={isToday}
              isNext={isNext}
              isSkip={isSkip}
              isDelayed={isDelayed}
              hasNote={hasNote}
              hasContentOv={hasContentOv}
              hasAnyOverride={hasAnyOverride}
              override={override}
              onSave={(next) => onSaveClassOverride(cls, next)}
            />
          </td>
        );
      })}
    </tr>
  );
}

// ─── クラス進捗型 ────────────────────────────────────────────

interface ClassProgress {
  completedCount: number;  // 今日より前に完了したコマ数
  totalSlots: number;      // 全スロット数
  nextRowIdx: number | null; // 次回授業の行インデックス（0-based）
  todayRowIndices: number[]; // 今日の授業行インデックス（0-based）
}

// ─── 計画テーブル ─────────────────────────────────────────────

interface PlanTableProps {
  plan: GradeSubjectPlan;
  classes: string[];
  effectiveEntries: TimetableEntry[];
  onUpdateLessons: (lessons: LessonPlanEntry[]) => void;
  onUpdateUnits: (units: TeachingUnit[]) => void;
}

function PlanTable({ plan, classes, effectiveEntries, onUpdateLessons, onUpdateUnits }: PlanTableProps) {
  const { t } = useLanguage();
  const [showUnits, setShowUnits] = useState(false);

  const classSlots = useMemo(() => {
    const result: Record<string, Array<{ date: string; period: number; weekday_jp: string }>> = {};
    for (const cls of classes) {
      result[cls] = computeClassLessonSlots(effectiveEntries, cls, plan.subject);
    }
    return result;
  }, [effectiveEntries, classes, plan.subject]);

  // 計画レイアウト（単元順 × plannedPeriods で自動導出）
  const plannedRows = useMemo(() => {
    const rows: Array<{ unitId: string; unitPeriod: number }> = [];
    for (const unit of plan.units) {
      const periods = Math.max(0, unit.plannedPeriods || 0);
      for (let i = 0; i < periods; i++) {
        rows.push({ unitId: unit.id, unitPeriod: i + 1 });
      }
    }
    return rows;
  }, [plan.units]);

  // 行数: timetableスロット数・lessons配列・計画行数の最大値
  const maxSlots = useMemo(() => {
    const fromSlots = classes.map(cls => (classSlots[cls] ?? []).length);
    return Math.max(plan.lessons.length, ...fromSlots, plannedRows.length, 0);
  }, [classSlots, classes, plan.lessons.length, plannedRows.length]);

  // 単元→インデックスマップ（カラー用）
  const unitIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    plan.units.forEach((u, i) => m.set(u.id, i));
    return m;
  }, [plan.units]);

  // 行データ生成：計画(plannedRows) と 実績(lessons) をマージ
  const rows = useMemo(() => {
    const lessonsByNum = new Map<number, LessonPlanEntry>();
    plan.lessons.forEach((l, i) => lessonsByNum.set(i + 1, l));

    const unitCounts = new Map<string, number>();

    return Array.from({ length: maxSlots }, (_, i) => {
      const n = i + 1;
      const entry = lessonsByNum.get(n) ?? null;
      const plannedSlot = plannedRows[i] ?? null;

      // 実績unitIdが空 → 計画のunitIdにフォールバック
      const overrideUnitId = entry?.unitId ?? "";
      const effectiveUnitId = overrideUnitId || (plannedSlot?.unitId ?? "");
      const isFromPlan = !overrideUnitId && !!plannedSlot?.unitId;

      const unit = effectiveUnitId ? (plan.units.find(u => u.id === effectiveUnitId) ?? null) : null;
      const unitColorIdx = unit ? (unitIndexMap.get(unit.id) ?? 0) : 0;

      // v97: isSkipは廃止。常にunitPeriodをカウント
      let unitPeriod = 0;
      if (effectiveUnitId) {
        const count = (unitCounts.get(effectiveUnitId) ?? 0) + 1;
        unitCounts.set(effectiveUnitId, count);
        unitPeriod = count;
      }

      // v94: 単元マスターから計画内容を取得（コマlessons[]が空のときフォールバック）
      let planContent = "";
      if (unit && unitPeriod > 0) {
        const masterLesson = unit.lessons?.find(l => l.period === unitPeriod);
        planContent = masterLesson?.content ?? "";
      }

      // v98: isSkip機能は廃止。授業がなくなれば時間割管理画面でコマ削除すれば
      //      右側の実施日は自動的に空欄になるため、ここでの「実施なし」指定は不要。
      //      旧ロジック（復活する場合はコメント解除）:
      //      const isSkip = entry?.isSkip ?? false;
      const isSkip = false;

      return { n, entry, unit, unitColorIdx, effectiveUnitId, unitPeriod, isFromPlan, planContent, isSkip };
    });
  }, [maxSlots, plan.lessons, plan.units, unitIndexMap, plannedRows]);

  // lessons配列を更新するヘルパー（不足分を自動補完）
  const updateLesson = useCallback((lessonNumber: number, saved: LessonPlanEntry) => {
    const next = [...plan.lessons];
    while (next.length < lessonNumber) {
      next.push({ id: nanoid(8), unitId: "", unitPeriod: next.length + 1, content: "" });
    }
    next[lessonNumber - 1] = saved;
    onUpdateLessons(next);
  }, [plan.lessons, onUpdateLessons]);

  // v97 Phase1: クラス別オーバーライドを更新
  const updateClassOverride = useCallback((lessonNumber: number, cls: string, override: ClassLessonOverride | null) => {
    const next = [...plan.lessons];
    while (next.length < lessonNumber) {
      next.push({ id: nanoid(8), unitId: "", unitPeriod: next.length + 1, content: "" });
    }
    const current = next[lessonNumber - 1];
    const existing = current.classOverrides ?? {};
    const newOverrides: Record<string, ClassLessonOverride> = { ...existing };
    if (override === null) {
      delete newOverrides[cls];
    } else {
      newOverrides[cls] = override;
    }
    next[lessonNumber - 1] = {
      ...current,
      classOverrides: Object.keys(newOverrides).length > 0 ? newOverrides : undefined,
    };
    onUpdateLessons(next);
  }, [plan.lessons, onUpdateLessons]);

  // v96: 行の挿入・削除・スキップトグルは廃止
  // 計画行数の変更は単元管理パネルでplannedPeriodsを編集することで行う
  // クラス別の進度差分は今後の classOverrides 機構で対応予定

  // 今日の日付
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // v100: クラス毎「計画行(1-based) → 実施スロットindex」のマッピング
  // - delayed: 進まなかった日を1スロット余分に消費 → 後続が後ろにシフト
  // - advanced: 前のコマと同じ実施日（1日2コマ） → 後続が前にシフト
  // overflowRows: 繰越の結果、読み込み済み時間割の範囲を超えてしまった行（日程超過）
  const { classRowSlotMap, classOverflowRows } = useMemo(() => {
    const map2: Record<string, Map<number, number>> = {};
    const overflow2: Record<string, Set<number>> = {};
    for (const cls of classes) {
      const slots = classSlots[cls] ?? [];
      const map = new Map<number, number>();
      const overflow = new Set<number>();
      let slotIdx = 0;
      let lastSlotIdx = -1;
      for (let row = 1; row <= maxSlots; row++) {
        const ov = plan.lessons[row - 1]?.classOverrides?.[cls];
        const delayed = ov?.delayed ?? false;
        const advanced = ov?.advanced ?? false;

        // advanced: 前の行と同じ実施日（スロットを消費しない）
        if (advanced && !delayed && lastSlotIdx >= 0) {
          map.set(row, lastSlotIdx);
          continue;
        }
        if (delayed) {
          // 「進まなかった日」を1スロット消費 → 完了は次のスロット
          slotIdx += 1;
        }
        if (slotIdx < slots.length) {
          map.set(row, slotIdx);
          lastSlotIdx = slotIdx;
        } else if (slots.length > 0) {
          // 繰越の結果、読み込み済み時間割の範囲を超過
          overflow.add(row);
        }
        slotIdx += 1;
      }
      map2[cls] = map;
      overflow2[cls] = overflow;
    }
    return { classRowSlotMap: map2, classOverflowRows: overflow2 };
  }, [classes, classSlots, plan.lessons, maxSlots]);

  // クラス別進捗（delayed考慮の行→スロット対応で再計算）
  const classProgress = useMemo((): Record<string, ClassProgress> => {
    const result: Record<string, ClassProgress> = {};
    for (const cls of classes) {
      const slots = classSlots[cls] ?? [];
      const rowMap = classRowSlotMap[cls] ?? new Map<number, number>();
      let completedCount = 0;
      const todayRowIndices: number[] = [];
      let nextRowIdx: number | null = null;
      for (let row = 1; row <= maxSlots; row++) {
        const sIdx = rowMap.get(row);
        if (sIdx === undefined) continue;
        const d = slots[sIdx]?.date;
        if (!d) continue;
        const rowIdx = row - 1; // 0-based（既存表示ロジックと整合）
        if (d < today) {
          completedCount++;
        } else if (d === today) {
          todayRowIndices.push(rowIdx);
        } else {
          if (nextRowIdx === null) nextRowIdx = rowIdx;
        }
      }
      const effectiveNext = todayRowIndices.length > 0 ? todayRowIndices[0] : nextRowIdx;
      result[cls] = { completedCount, totalSlots: slots.length, nextRowIdx: effectiveNext, todayRowIndices };
    }
    return result;
  }, [classSlots, classes, today, classRowSlotMap, maxSlots]);

  // クラス間の最大完了数（進捗ギャップ計算用）
  const maxCompleted = useMemo(() =>
    Math.max(0, ...classes.map(c => classProgress[c]?.completedCount ?? 0)),
  [classes, classProgress]);

  const filledCount = plan.lessons.filter(l => l.content && !l.isSkip).length;
  // v98: isSkip廃止に伴い skipCount 表示も停止（旧ロジックはコメントで保持）
  // const skipCount = plan.lessons.filter(l => l.isSkip).length;
  const skipCount = 0;

  return (
    <div className="space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <span className="font-semibold text-foreground text-sm">{plan.grade} {plan.subject}</span>
        <span>{tpf(t, "tp.allKoma", { n: maxSlots })}</span>
        {plannedRows.length > 0 && (
          <span className="text-blue-600/80">{tpf(t, "tp.planAutoAssign", { n: plannedRows.length })}</span>
        )}
        {filledCount > 0 && <span className="text-emerald-600">{tpf(t, "tp.komaFilled", { n: filledCount })}</span>}
        {skipCount > 0 && <span className="text-orange-500">{tpf(t, "tp.komaNotHeld", { n: skipCount })}</span>}
        <span>{tpf(t, "tp.targetClasses", { c: classes.join("・") })}</span>
      </div>

      {/* 単元管理 */}
      <div className="border border-border rounded-md">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/30"
          onClick={() => setShowUnits(!showUnits)}
        >
          <span className="flex items-center gap-1.5">
            <GripVertical size={11} className="text-muted-foreground" />
            {t("tp.unitMgmt")}
            {plan.units.length > 0 && (
              <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">{tpf(t, "tp.itemsCount", { n: plan.units.length })}</span>
            )}
            {plan.units.length === 0 && (
              <span className="text-[10px] text-muted-foreground/60">{t("tp.unitMgmtEmptyHint")}</span>
            )}
          </span>
          <ChevronDown size={12} className={cn("transition-transform text-muted-foreground", showUnits && "rotate-180")} />
        </button>
        {showUnits && (
          <div className="px-3 py-2 border-t border-border">
            <UnitEditor units={plan.units} onChange={onUpdateUnits} />
          </div>
        )}
      </div>

      {/* クラス別進捗サマリー */}
      {classes.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap text-[10px]">
          {classes.map(cls => {
            const prog = classProgress[cls];
            if (!prog || prog.totalSlots === 0) return null;
            const pct = Math.round(prog.completedCount / prog.totalSlots * 100);
            const gap = maxCompleted - prog.completedCount;
            return (
              <div key={cls} className="flex items-center gap-1.5">
                <span className="text-muted-foreground shrink-0">{cls}</span>
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all",
                      gap > 0 ? "bg-orange-400" : "bg-emerald-500"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={cn("shrink-0", gap > 0 ? "text-orange-500" : "text-muted-foreground")}>
                  {prog.completedCount}/{prog.totalSlots}
                  {gap > 0 ? ` (−${gap})` : prog.completedCount === prog.totalSlots ? " ✓" : ""}
                </span>
              </div>
            );
          })}
          {maxCompleted > 0 && (
            <span className="text-muted-foreground/50 ml-1">
              {t("tp.markLegend")}
            </span>
          )}
        </div>
      )}

      {/* 操作ヒント */}
      <p className="text-[10px] text-muted-foreground/60 -mt-1">
        {t("tp.opHint")}<span className="text-orange-600/80 font-medium">{t("tp.opHintClass")}</span>
      </p>

      {/* テーブル */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground border-b border-border">
              <th className="px-1 py-2 text-center w-12 font-medium">No.</th>
              <th className="px-2 py-2 w-32 font-medium">{t("tp.colUnit")}</th>
              <th className="px-2 py-2 text-center w-10 font-medium">{t("tp.colUnitInner")}</th>
              <th className="px-2 py-2 min-w-[160px] font-medium">{t("tp.colContent")}</th>
              {classes.map(cls => {
                const prog = classProgress[cls];
                const gap = prog ? maxCompleted - prog.completedCount : 0;
                return (
                  <th key={cls} className="px-2 py-2 text-center w-20 font-medium">
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{cls}</span>
                      {prog && prog.totalSlots > 0 && (
                        <span className={cn(
                          "text-[9px] font-normal rounded px-1.5 py-0.5",
                          prog.completedCount === prog.totalSlots
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : prog.completedCount > 0
                            ? "bg-muted text-muted-foreground"
                            : "text-muted-foreground/50",
                        )}>
                          {tpf(t, "tp.completedFraction", { a: prog.completedCount, b: prog.totalSlots })}
                        </span>
                      )}
                      {gap > 0 && (
                        <span className="text-[9px] text-orange-500 font-normal">{tpf(t, "tp.behindBy", { n: gap })}</span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {maxSlots === 0 ? (
              <tr>
                <td colSpan={4 + classes.length} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {t("tp.noTimetableData")}
                </td>
              </tr>
            ) : (
              rows.map(({ n, entry, unit, unitColorIdx, unitPeriod, effectiveUnitId, isFromPlan, isSkip, planContent }) => (
                <LessonRow
                  key={n}
                  lessonNumber={n}
                  entry={entry}
                  unit={unit}
                  unitColorIdx={unitColorIdx}
                  unitPeriod={unitPeriod}
                  effectiveUnitId={effectiveUnitId}
                  isFromPlan={isFromPlan}
                  planContent={planContent}
                  units={plan.units}
                  classSlots={classSlots}
                  classes={classes}
                  isSkip={isSkip}
                  today={today}
                  classProgress={classProgress}
                  classRowSlotMap={classRowSlotMap}
                  classOverflowRows={classOverflowRows}
                  onSave={(saved) => updateLesson(n, saved)}
                  onSaveClassOverride={(cls, ov) => updateClassOverride(n, cls, ov)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

// ─── 手動追加ダイアログ ────────────────────────────────────────

interface ManualAddDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (plan: GradeSubjectPlan) => void;
  existingIds: Set<string>;
}

function ManualAddDialog({ open, onClose, onCreate, existingIds }: ManualAddDialogProps) {
  const { t } = useLanguage();
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const planId = `${grade.trim()}|||${subject.trim()}`;
  const alreadyExists = existingIds.has(planId);

  const handleCreate = () => {
    if (!grade.trim() || !subject.trim() || alreadyExists) return;
    onCreate({ id: planId, grade: grade.trim(), subject: subject.trim(), units: [], lessons: [] });
    setGrade(""); setSubject("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{t("tp.manualAddTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">{t("tp.manualAddDesc")}</p>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">{t("tp.gradeLabel")}</Label>
            <Input value={grade} onChange={e => setGrade(e.target.value)} className="h-8 text-xs" placeholder={t("tp.gradePh")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("tp.subjectLabel")}</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} className="h-8 text-xs" placeholder={t("tp.subjectPh")}
              onKeyDown={e => e.key === "Enter" && handleCreate()} />
          </div>
          {alreadyExists && <p className="text-xs text-destructive">{t("tp.alreadyExists")}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-xs">{t("tp.cancel")}</Button>
          <Button size="sm" onClick={handleCreate} disabled={!grade.trim() || !subject.trim() || alreadyExists} className="h-7 text-xs">{t("tp.add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── メインView ───────────────────────────────────────────────

// ─── v104 Phase B: 学級担任用 教科一瞥ビュー ───────────────────────

interface HomeroomClassViewProps {
  combos: Array<{ grade: string; subject: string; classes: string[] }>;
  effectiveEntries: TimetableEntry[];
  planMap: Map<string, GradeSubjectPlan>;
  hiddenSubjectSet: Set<string>;
  hiddenComboSet: Set<string>;
  onJumpToSubject: (planId: string) => void;
}

function statusCellColor(s: ClassPlanRowStatus, delayed: boolean, advanced: boolean): string {
  if (delayed) return "bg-orange-400";
  if (advanced) return "bg-sky-400";
  switch (s) {
    case "past": return "bg-emerald-400";
    case "today": return "bg-amber-400";
    case "future": return "bg-muted-foreground/20";
    case "overflow": return "bg-rose-400";
    default: return "bg-transparent";
  }
}

function HomeroomClassView({ combos, effectiveEntries, planMap, hiddenSubjectSet, hiddenComboSet, onJumpToSubject }: HomeroomClassViewProps) {
  const { t } = useLanguage();
  const allClasses = useMemo(() => {
    const set = new Set<string>();
    for (const c of combos) for (const cl of c.classes) set.add(cl);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [combos]);

  const [selectedClass, setSelectedClass] = useState<string>("");
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));
  // v107 Phase F: 単元名/内容/日付を複数選択（選択したものを全て表示）
  const [fields, setFields] = useState<{ unit: boolean; content: boolean; date: boolean }>({
    unit: true, content: true, date: true,
  });
  const toggleField = (k: "unit" | "content" | "date") =>
    setFields(prev => {
      const next = { ...prev, [k]: !prev[k] };
      // 最低1つは残す
      if (!next.unit && !next.content && !next.date) return prev;
      return next;
    });

  useEffect(() => {
    if (allClasses.length > 0 && !allClasses.includes(selectedClass)) {
      setSelectedClass(allClasses[0]);
    }
  }, [allClasses, selectedClass]);

  // 選択クラスが持つ教科一覧
  const subjects = useMemo(() => {
    if (!selectedClass) return [];
    const gradeMatch = selectedClass.match(/^(\d+)年/);
    const grade = gradeMatch ? `${gradeMatch[1]}年` : "";
    return combos
      .filter(c => c.classes.includes(selectedClass))
      .filter(c => !hiddenSubjectSet.has(c.subject) && !hiddenComboSet.has(`${c.grade}|||${c.subject}`)) // v105/v107: 非表示除外
      .map(c => ({ grade: c.grade || grade, subject: c.subject, planId: `${c.grade}|||${c.subject}` }))
      .sort((a, b) => a.subject.localeCompare(b.subject, "ja"));
  }, [combos, selectedClass, hiddenSubjectSet, hiddenComboSet]);

  const fmtDate = (slot?: { date: string; weekday_jp: string; period: number }) =>
    slot ? `${slot.date.slice(5).replace("-", "/")} ${slot.weekday_jp}${slot.period}` : "—";

  // v107 Phase F: 選択中フィールドを縦に併記
  const cellContent = (r: ClassPlanRow | undefined) => {
    if (!r) return <span className="text-muted-foreground">—</span>;
    const parts: ReactNode[] = [];
    if (fields.unit) parts.push(<span key="u" className="block truncate">{r.unitName || t("tp.unitNotSet")}</span>);
    if (fields.content) parts.push(<span key="c" className="block truncate text-muted-foreground">{r.content || t("tp.contentNotEntered")}</span>);
    if (fields.date) parts.push(<span key="d" className="block text-[10px] text-muted-foreground/80">{fmtDate(r.slot)}</span>);
    return <span className="leading-tight">{parts}</span>;
  };

  return (
    <div className="space-y-3">
      {/* 操作バー */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">{t("tp.classLabel")}</Label>
          <select
            value={selectedClass}
            onChange={e => setSelectedClass(e.target.value)}
            className="h-8 text-sm border border-border rounded-md px-2 bg-background min-w-[110px]"
          >
            {allClasses.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">{t("tp.asOfLabel")}</Label>
          <Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="h-8 w-36 text-sm" />
          <button onClick={() => setAsOf(new Date().toISOString().slice(0, 10))}
            className="text-[11px] text-primary hover:underline">{t("tp.todayBtn")}</button>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Label className="text-xs text-muted-foreground mr-1">{t("tp.viewLabel")}</Label>
          {([
            ["unit", t("tp.fieldUnit")],
            ["content", t("tp.fieldContent")],
            ["date", t("tp.fieldDate")],
          ] as [keyof typeof fields, string][]).map(([k, label]) => (
            <button key={k} onClick={() => toggleField(k)}
              className={cn(
                "text-[11px] px-2 py-1 rounded border transition-colors flex items-center gap-1",
                fields[k] ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground hover:bg-muted/40",
              )}>
              <span className={cn("w-2.5 h-2.5 rounded-sm border inline-block", fields[k] ? "bg-primary border-primary" : "border-muted-foreground/40")} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />{t("tp.legendDone")}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />{t("tp.legendToday")}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block ring-1 ring-green-600" />{t("tp.legendNext")}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-muted-foreground/20 inline-block" />{t("tp.legendNotYet")}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block" />{t("tp.legendBehind")}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400 inline-block" />{t("tp.legendAhead")}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400 inline-block" />{t("tp.legendOverflow")}</span>
      </div>

      {subjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
          <BookOpen size={28} className="text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("tp.noClassSubjectData")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-medium w-24">{t("tp.colSubject")}</th>
                <th className="px-2 py-2 font-medium w-28">{t("tp.colProgress")}</th>
                <th className="px-2 py-2 font-medium min-w-[140px]">{t("tp.colCurrent")}</th>
                <th className="px-2 py-2 font-medium min-w-[140px]">{t("tp.colNext")}</th>
                <th className="px-2 py-2 font-medium w-24">{t("tp.colNextDate")}</th>
                <th className="px-2 py-2 font-medium min-w-[200px]">{t("tp.colChart")}</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map(({ subject, planId, grade }) => {
                const plan = planMap.get(planId) ?? { id: planId, grade, subject, units: [], lessons: [] };
                const prog = computeClassPlanProgress(plan, selectedClass, effectiveEntries, asOf);
                const pct = prog.totalSlots > 0 ? Math.round(prog.completedCount / prog.totalSlots * 100) : 0;
                return (
                  <tr key={planId} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onJumpToSubject(planId)}
                        className="text-xs font-medium text-foreground hover:text-primary hover:underline text-left"
                        title={t("tp.openSubjectPlan")}
                      >
                        {subject}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {prog.completedCount}/{prog.totalSlots}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="text-xs">
                        {prog.currentRow ? cellContent(prog.currentRow) : (
                          <span className="text-muted-foreground">{prog.completedCount === 0 ? t("tp.notStarted") : "—"}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className={cn(
                        "text-xs",
                        prog.nextRow?.status === "today" ? "text-amber-700 font-semibold dark:text-amber-400" :
                        prog.nextRow ? "text-green-700 font-semibold dark:text-green-400" : "text-muted-foreground",
                      )}>
                        {prog.nextRow ? (
                          <>
                            <span className="text-[10px]">{prog.nextRow.status === "today" ? t("tp.todayMark") : t("tp.nextMark")}</span>
                            {cellContent(prog.nextRow)}
                          </>
                        ) : t("tp.done")}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-[11px] whitespace-nowrap text-muted-foreground">
                      {prog.nextRow ? fmtDate(prog.nextRow.slot) : "—"}
                      {prog.hasOverflow && <AlertTriangle size={10} className="inline ml-1 text-rose-500" />}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-px flex-wrap max-w-[360px]">
                        {prog.rows.map(r => {
                          const isNext = prog.nextRow?.n === r.n && r.status !== "today";
                          return (
                            <span
                              key={r.n}
                              className={cn(
                                "w-2 h-3.5 rounded-[1px] shrink-0",
                                statusCellColor(r.status, r.delayed, r.advanced),
                                isNext && "ring-1 ring-green-600",
                              )}
                              title={`${tpf(t, "tp.chartCellTitle", { n: r.n, unit: r.unitName })}${r.content ? ` / ${r.content}` : ""}${r.slot ? ` (${fmtDate(r.slot)})` : r.status === "overflow" ? t("tp.overflowParen") : ""}${r.delayed ? t("tp.behindShort") : r.advanced ? t("tp.advancedShort") : ""}`}
                            />
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60">
        {t("tp.jumpHint")}
      </p>
    </div>
  );
}

export function TeachingPlanView() {
  const {
    effectiveEntries,
    teachingPlans,
    upsertTeachingPlan,
    removeTeachingPlan,
    teachingPlanHiddenSubjects,
    toggleTeachingPlanHiddenSubject,
    teachingPlanHiddenCombos,
    toggleTeachingPlanHiddenCombo,
    isLoaded,
    mode,
    currentFile,
  } = useTimetable();
  const { t } = useLanguage();

  // ── Excel 書き出し / 読み込み ──────────────────────────────
  const excelInputRef = useRef<HTMLInputElement>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  // ── テンプレートから取り込む ───────────────────────────────
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);

  const handleExcelExport = useCallback(async () => {
    if (teachingPlans.length === 0) {
      toast.warning(t("tp.excelNoPlans"));
      return;
    }
    setExcelBusy(true);
    try {
      await exportTeachingPlansToExcel(teachingPlans, currentFile?.meta.title ?? "");
      toast.success(t("tp.excelExported"));
    } catch (e) {
      toast.error(`Excel書き出しに失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExcelBusy(false);
    }
  }, [teachingPlans, currentFile, t]);

  const handleExcelImport = useCallback(async (file: File) => {
    setExcelBusy(true);
    try {
      const { plans, skippedSheets } = await importTeachingPlansFromExcel(file, teachingPlans);
      if (plans.length === 0) {
        toast.error(t("tp.excelNoValidSheets"));
        return;
      }
      plans.forEach((p) => upsertTeachingPlan(p));
      toast.success(
        tpf(t, "tp.excelImported", { n: plans.length }) +
          (skippedSheets.length > 0 ? `（スキップ: ${skippedSheets.join(", ")}）` : "")
      );
    } catch (e) {
      toast.error(`Excel読み込みに失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExcelBusy(false);
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  }, [teachingPlans, upsertTeachingPlan, t]);

  const hiddenSubjectSet = useMemo(
    () => new Set(teachingPlanHiddenSubjects),
    [teachingPlanHiddenSubjects]
  );
  const hiddenComboSet = useMemo(
    () => new Set(teachingPlanHiddenCombos),
    [teachingPlanHiddenCombos]
  );

  const combos = useMemo(() => extractGradeSubjectCombos(effectiveEntries), [effectiveEntries]);

  const planMap = useMemo(() => {
    const m = new Map<string, GradeSubjectPlan>();
    for (const p of teachingPlans) m.set(p.id, p);
    return m;
  }, [teachingPlans]);

  const manualOnlyPlans = useMemo(() => {
    const comboIds = new Set(combos.map(c => `${c.grade}|||${c.subject}`));
    return teachingPlans.filter(p => !comboIds.has(p.id));
  }, [teachingPlans, combos]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // v104 Phase B: ビュー切替（学級担任モードはクラス横断を初期表示）
  const [mainView, setMainView] = useState<"subject" | "homeroom">(
    mode === "homeroom" ? "homeroom" : "subject"
  );

  useEffect(() => {
    if (combos.length > 0 && !selectedId) {
      setSelectedId(`${combos[0].grade}|||${combos[0].subject}`);
    }
  }, [combos, selectedId]);

  const existingIds = useMemo(() => new Set(teachingPlans.map(p => p.id)), [teachingPlans]);

  const activePlan = useMemo((): GradeSubjectPlan | null => {
    if (!selectedId) return null;
    if (planMap.has(selectedId)) return planMap.get(selectedId)!;
    const parts = selectedId.split("|||");
    if (parts.length !== 2) return null;
    return { id: selectedId, grade: parts[0], subject: parts[1], units: [], lessons: [] };
  }, [selectedId, planMap]);

  const activeClasses = useMemo(() => {
    if (!activePlan) return [];
    return combos.find(c => c.grade === activePlan.grade && c.subject === activePlan.subject)?.classes ?? [];
  }, [activePlan, combos]);

  const slotCountMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const combo of combos) {
      const id = `${combo.grade}|||${combo.subject}`;
      const maxCount = Math.max(
        0,
        ...combo.classes.map(cls => computeClassLessonSlots(effectiveEntries, cls, combo.subject).length)
      );
      m.set(id, maxCount);
    }
    return m;
  }, [combos, effectiveEntries]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t("tp.loadFilePrompt")}
      </div>
    );
  }

  const allSidebarItemsRaw = [
    ...combos.map(c => ({ id: `${c.grade}|||${c.subject}`, grade: c.grade, subject: c.subject, fromTimetable: true })),
    ...manualOnlyPlans.map(p => ({ id: p.id, grade: p.grade, subject: p.subject, fromTimetable: false })),
  ];
  // v105/v107: 教科名(全学年) または combo(学年×教科) 単位で非表示
  const isItemHidden = (item: { id: string; subject: string }) =>
    hiddenSubjectSet.has(item.subject) || hiddenComboSet.has(item.id);
  const allSidebarItems = allSidebarItemsRaw.filter(item => !isItemHidden(item));
  // 全学年一括非表示の教科
  const hiddenSubjectsInUse = Array.from(
    new Set(allSidebarItemsRaw.filter(item => hiddenSubjectSet.has(item.subject)).map(i => i.subject))
  ).sort((a, b) => a.localeCompare(b, "ja"));
  // combo単位で非表示（全学年非表示には含まれないもの）
  const hiddenCombosInUse = allSidebarItemsRaw
    .filter(item => hiddenComboSet.has(item.id) && !hiddenSubjectSet.has(item.subject))
    .sort((a, b) => a.id.localeCompare(b.id, "ja"));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* v104 Phase B: ビュー切替タブ */}
      <div className="flex items-center gap-1 px-3 pt-3 border-b border-border shrink-0">
        <button
          onClick={() => setMainView("homeroom")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
            mainView === "homeroom"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <BookOpen size={13} />{t("tp.tabHomeroom")}
        </button>
        <button
          onClick={() => setMainView("subject")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
            mainView === "subject"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <FileText size={13} />{t("tp.tabSubject")}
        </button>

        {/* テンプレート / Excel 書き出し / 読み込み */}
        <div className="ml-auto flex items-center gap-1.5 pb-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            disabled={mainView !== "subject" || !activePlan}
            onClick={() => setShowTemplateDialog(true)}
            title={t("tpl.buttonTitle")}
          >
            <BookMarked size={13} className="text-indigo-600" />
            {t("tpl.button")}
          </Button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleExcelImport(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            disabled={excelBusy}
            onClick={handleExcelExport}
            title={t("tp.excelExportTitle")}
          >
            <FileSpreadsheet size={13} className="text-emerald-600" />
            {t("tp.excelExportBtn")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            disabled={excelBusy}
            onClick={() => excelInputRef.current?.click()}
            title={t("tp.excelImportTitle")}
          >
            <Upload size={13} className="text-indigo-600" />
            {t("tp.excelImportBtn")}
          </Button>
        </div>
      </div>

      {mainView === "homeroom" ? (
        <div className="flex-1 overflow-auto p-4">
          <HomeroomClassView
            combos={combos}
            effectiveEntries={effectiveEntries}
            planMap={planMap}
            hiddenSubjectSet={hiddenSubjectSet}
            hiddenComboSet={hiddenComboSet}
            onJumpToSubject={(planId) => { setSelectedId(planId); setMainView("subject"); }}
          />
        </div>
      ) : (
      <div className="flex flex-1 overflow-hidden">
      {/* ── 左サイドバー ── */}
      <div className="w-48 shrink-0 border-r border-border flex flex-col bg-muted/10">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">{t("tp.gradeSubject")}</span>
          <span className="text-[10px] text-muted-foreground">{tpf(t, "tp.itemsCount", { n: allSidebarItems.length })}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {allSidebarItems.length === 0 ? (
            <div className="px-3 py-6 text-xs text-muted-foreground text-center">
              <BookOpen size={20} className="mx-auto mb-2 opacity-30" />
              {t("tp.noSubjectData")}
            </div>
          ) : (
            allSidebarItems.map(item => {
              const hasPlan = planMap.has(item.id);
              // v107 Phase H: filledCountバッジは一旦コメントアウト（進捗と紛らわしいため）
              // const plan = planMap.get(item.id);
              // const filledCount = plan?.lessons.filter(l => l.content && !l.isSkip).length ?? 0;
              // v98: isSkip廃止（旧ロジックはコメントで保持）
              // const skipCount = plan?.lessons.filter(l => l.isSkip).length ?? 0;
              const skipCount = 0;
              const totalCount = slotCountMap.get(item.id) ?? 0;
              const isSelected = selectedId === item.id;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "group/side relative border-b border-border/30 transition-colors",
                    isSelected
                      ? "bg-primary/10 border-l-2 border-l-primary"
                      : "hover:bg-muted/50"
                  )}
                >
                  <button
                    onClick={() => setSelectedId(item.id)}
                    className="w-full text-left px-3 py-2.5 pr-7"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("text-xs font-medium truncate", isSelected ? "text-foreground" : "text-muted-foreground")}>
                        {item.grade} {item.subject}
                      </span>
                      {/* v107 Phase H: 「内容入力済/全コマ」バッジは進捗と紛らわしく、
                          クラス毎に進捗が異なり採用が難しいため一旦コメントアウト。
                          進捗は「クラス別ビュー」を参照。将来再検討時はコメント解除。
                      {hasPlan && filledCount > 0 && (
                        <span className="text-[9px] bg-emerald-100 text-emerald-700 rounded px-1 shrink-0">
                          {filledCount}/{totalCount}
                        </span>
                      )} */}
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 flex gap-1.5">
                      {item.fromTimetable && <span>{totalCount}{t("tp.komaCountSuffix")}</span>}
                      {skipCount > 0 && <span className="text-orange-500">{skipCount}</span>}
                      {!hasPlan && item.fromTimetable && <span className="opacity-50">{t("tp.notEntered")}</span>}
                      {!item.fromTimetable && <span className="opacity-50">{t("tp.manualAdded")}</span>}
                    </div>
                  </button>
                  {/* v107 Phase G: その学年×教科だけ非表示 */}
                  <button
                    onClick={() => toggleTeachingPlanHiddenCombo(item.id)}
                    title={tpf(t, "tp.hideThisCombo", { g: item.grade, s: item.subject })}
                    className="absolute top-2 right-1.5 p-1 rounded opacity-0 group-hover/side:opacity-100 text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-opacity"
                  >
                    <EyeOff size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* v105/v107: 非表示一覧（combo / 全学年、いつでも再表示） */}
        {(hiddenCombosInUse.length > 0 || hiddenSubjectsInUse.length > 0) && (
          <div className="border-t border-border px-2 py-2 space-y-1.5">
            {hiddenCombosInUse.length > 0 && (
              <div>
                <div className="text-[10px] text-muted-foreground/70 mb-1 flex items-center gap-1">
                  <EyeOff size={10} />{tpf(t, "tp.hiddenN", { n: hiddenCombosInUse.length })}
                </div>
                <div className="flex flex-wrap gap-1">
                  {hiddenCombosInUse.map(item => (
                    <span key={item.id} className="inline-flex items-center rounded border border-dashed border-border overflow-hidden">
                      <button
                        onClick={() => toggleTeachingPlanHiddenCombo(item.id)}
                        title={tpf(t, "tp.showThisCombo", { g: item.grade, s: item.subject })}
                        className="text-[10px] px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center gap-0.5"
                      >
                        <Eye size={10} />{item.grade} {item.subject}
                      </button>
                      <button
                        onClick={() => toggleTeachingPlanHiddenSubject(item.subject)}
                        title={tpf(t, "tp.hideAllGrades", { s: item.subject })}
                        className="text-[9px] px-1 py-0.5 border-l border-dashed border-border text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
                      >
                        {t("tp.allGrades")}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {hiddenSubjectsInUse.length > 0 && (
              <div>
                <div className="text-[10px] text-muted-foreground/70 mb-1 flex items-center gap-1">
                  <EyeOff size={10} />{tpf(t, "tp.allGradesHiddenN", { n: hiddenSubjectsInUse.length })}
                </div>
                <div className="flex flex-wrap gap-1">
                  {hiddenSubjectsInUse.map(subj => (
                    <button
                      key={subj}
                      onClick={() => toggleTeachingPlanHiddenSubject(subj)}
                      title={tpf(t, "tp.showAllGrades", { s: subj })}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center gap-0.5"
                    >
                      <Eye size={10} />{subj}{t("tp.allGradesParen")}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="p-2 border-t border-border">
          <Button
            size="sm"
            variant="ghost"
            className="w-full h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setShowManualAdd(true)}
          >
            <Plus size={11} />{t("tp.manualAddBtn")}
          </Button>
        </div>
      </div>

      {/* ── 右側: テーブル ── */}
      <div className="flex-1 overflow-auto p-4">
        {activePlan ? (
          <>
            <PlanTable
              key={activePlan.id}
              plan={activePlan}
              classes={activeClasses}
              effectiveEntries={effectiveEntries}
              onUpdateLessons={(lessons) => upsertTeachingPlan({ ...activePlan, lessons })}
              onUpdateUnits={(units) => upsertTeachingPlan({ ...activePlan, units })}
            />
            {planMap.has(activePlan.id) && (
              <div className="mt-6 pt-4 border-t border-border/50">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmDeleteId(activePlan.id)}
                >
                  <Trash2 size={11} />{t("tp.deleteThisPlan")}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <FileText size={32} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">{t("tp.selectGradeSubject")}</p>
          </div>
        )}
      </div>

      <ManualAddDialog
        open={showManualAdd}
        onClose={() => setShowManualAdd(false)}
        onCreate={(plan) => { upsertTeachingPlan(plan); setSelectedId(plan.id); }}
        existingIds={existingIds}
      />

      <TeachingPlanTemplateDialog
        open={showTemplateDialog}
        onClose={() => setShowTemplateDialog(false)}
        initialGrade={activePlan?.grade}
        initialSubject={activePlan?.subject}
        getPlan={(id) => planMap.get(id) ?? null}
        onApply={(plan) => { upsertTeachingPlan(plan); setSelectedId(plan.id); }}
      />

      <Dialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">{t("tp.deleteConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground py-2">
            {t("tp.deleteConfirmBody")}
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)} className="h-7 text-xs">{t("tp.cancel")}</Button>
            <Button
              variant="destructive" size="sm" className="h-7 text-xs"
              onClick={() => {
                if (confirmDeleteId) {
                  removeTeachingPlan(confirmDeleteId);
                  if (selectedId === confirmDeleteId) setSelectedId(null);
                }
                setConfirmDeleteId(null);
              }}
            >{t("tp.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      )}
    </div>
  );
}
