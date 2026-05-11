// TeachingPlanView.tsx
// 指導計画画面：時間割から学年×教科を自動抽出し、一覧+テーブルで管理

import { useState, useMemo, useCallback, useEffect } from "react";
import { nanoid } from "nanoid";
import { useTimetable } from "@/contexts/TimetableContext";
import { GradeSubjectPlan, TeachingUnit, LessonPlanEntry } from "@/lib/timetableFile";
import { TimetableEntry } from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, BookOpen, ChevronDown, Pencil, Check, X, GripVertical, FileText, Ban,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

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

  if (disabled) {
    return <span className="text-[10px] text-muted-foreground/30 italic">実施なし</span>;
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
        <option value="">— なし（計画に戻す）</option>
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
      title={isFromPlan ? "自動計画（クリックで手動変更）" : "クリックして単元を変更"}
    >
      {unit ? (
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded border font-medium",
          getUnitColor(unitColorIdx),
          isFromPlan && "border-dashed opacity-70",
        )}>
          {unit.name}
          {isFromPlan && <span className="ml-0.5 text-[8px] opacity-50">計</span>}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/40 italic group-hover/unit:text-muted-foreground">
          単元を設定…
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPeriods, setEditPeriods] = useState("");

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
    const newUnit: TeachingUnit = { id: nanoid(8), name: "新しい単元", plannedPeriods: 4 };
    onChange([...units, newUnit]);
    setTimeout(() => startEdit(newUnit), 50);
  };

  const totalPlanned = units.reduce((s, u) => s + (u.plannedPeriods || 0), 0);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border/50">
        <span className="text-[10px] text-muted-foreground">単元を順番に並べ、計画コマ数を設定すると自動割り振りされます</span>
        {totalPlanned > 0 && (
          <span className="text-[10px] font-medium text-primary shrink-0 ml-2">計 {totalPlanned}コマ</span>
        )}
      </div>
      {units.map((u, idx) => (
        <div key={u.id} className="flex items-center gap-2 group">
          <GripVertical size={12} className="text-muted-foreground shrink-0" />
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0", getUnitColor(idx))}>
            {idx + 1}
          </span>
          {editingId === u.id ? (
            <>
              <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-6 text-xs flex-1" autoFocus
                onKeyDown={e => { if (e.key === "Enter") commitEdit(u.id); if (e.key === "Escape") setEditingId(null); }} />
              <Input value={editPeriods} onChange={e => setEditPeriods(e.target.value)} className="h-6 text-xs w-14" type="number" min={1} />
              <span className="text-xs text-muted-foreground shrink-0">コマ</span>
              <button onClick={() => commitEdit(u.id)} className="text-green-600 hover:text-green-700"><Check size={12} /></button>
              <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </>
          ) : (
            <>
              <span className="text-xs flex-1 truncate">{u.name}</span>
              <span className="text-[10px] font-medium text-primary shrink-0">{u.plannedPeriods}コマ</span>
              <button onClick={() => startEdit(u)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"><Pencil size={11} /></button>
              <button onClick={() => onChange(units.filter(x => x.id !== u.id))} className="opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive"><Trash2 size={11} /></button>
            </>
          )}
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 mt-1" onClick={addUnit}>
        <Plus size={11} /> 単元を追加
      </Button>
    </div>
  );
}

// ─── レッスン行 ────────────────────────────────────────────────

interface LessonRowProps {
  lessonNumber: number;          // 通し番号（isSkipでも表示上のNo.）
  contentIndex: number;          // isSkipを除いた実コンテンツ番号
  entry: LessonPlanEntry | null;
  unit: TeachingUnit | null;
  unitColorIdx: number;
  unitPeriod: number;            // 動的計算済み
  effectiveUnitId: string;       // 計画 or 手動override の実効unitId
  isFromPlan: boolean;           // trueなら自動計画から割り当て（手動変更なし）
  units: TeachingUnit[];
  classSlots: Record<string, Array<{ date: string; period: number; weekday_jp: string }>>;
  classes: string[];
  isSkip: boolean;
  today: string;                 // YYYY-MM-DD
  classProgress: Record<string, ClassProgress>;
  onSave: (entry: LessonPlanEntry) => void;
  onToggleSkip: () => void;
  onInsertBefore: () => void;
  onDelete: () => void;
}

function LessonRow({
  lessonNumber, entry, unit, unitColorIdx, unitPeriod, effectiveUnitId, isFromPlan, units,
  classSlots, classes, isSkip, today, classProgress, onSave, onToggleSkip, onInsertBefore, onDelete,
}: LessonRowProps) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(entry?.content ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");

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
    <tr className={cn(
      "border-b border-border/40 group/row transition-colors",
      isSkip ? "bg-muted/30 opacity-60" :
      isFromPlan ? "bg-blue-50/20 hover:bg-blue-50/40 dark:bg-blue-950/10" :
      "hover:bg-muted/20",
      editing && "bg-muted/30",
    )}>
      {/* No. セル: クリックでスキップ切替、ホバーで行操作 */}
      <td className="px-1 py-1.5 text-center w-12 shrink-0 relative">
        <div className="flex flex-col items-center gap-0.5">
          <button
            onClick={onToggleSkip}
            title={isSkip ? "実施ありに戻す" : "このコマを実施なしにする"}
            className={cn(
              "text-xs font-mono w-6 h-5 rounded flex items-center justify-center transition-colors",
              isSkip
                ? "bg-muted text-muted-foreground line-through"
                : "text-muted-foreground hover:bg-orange-100 hover:text-orange-600"
            )}
          >
            {isSkip ? <Ban size={10} /> : lessonNumber}
          </button>
          {/* ホバー時の行挿入・削除ボタン */}
          <div className="opacity-0 group-hover/row:opacity-100 flex gap-0.5 transition-opacity">
            <button
              onClick={onInsertBefore}
              title="この行の前に空行を挿入"
              className="text-[9px] text-muted-foreground hover:text-blue-600 hover:bg-blue-50 rounded px-0.5"
            >+行</button>
            <button
              onClick={onDelete}
              title="この行を削除"
              className="text-[9px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded px-0.5"
            >削除</button>
          </div>
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
          <span className="text-xs text-muted-foreground italic">実施なし</span>
        ) : editing ? (
          <div className="flex flex-col gap-1">
            <Input
              value={content}
              onChange={e => setContent(e.target.value)}
              className="h-6 text-xs"
              placeholder="内容予定"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) commit(); if (e.key === "Escape") cancel(); }}
            />
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="h-5 text-[10px]"
              placeholder="備考（任意）"
            />
            <div className="flex gap-1">
              <button onClick={commit} className="text-green-600 hover:text-green-700 text-[10px] flex items-center gap-0.5"><Check size={10} />保存</button>
              <button onClick={cancel} className="text-muted-foreground hover:text-foreground text-[10px] flex items-center gap-0.5"><X size={10} />取消</button>
            </div>
          </div>
        ) : (
          <div
            className="flex items-center gap-1 cursor-pointer min-h-[24px]"
            onClick={() => { setContent(entry?.content ?? ""); setNotes(entry?.notes ?? ""); setEditing(true); }}
          >
            <span className={cn("text-xs", entry?.content ? "text-foreground" : "text-muted-foreground/40 italic")}>
              {entry?.content || "クリックして入力…"}
            </span>
            <Pencil size={10} className="opacity-0 group-hover/row:opacity-60 text-muted-foreground shrink-0" />
          </div>
        )}
      </td>

      {/* クラス別実施日（今日/次回/済みをハイライト） */}
      {classes.map(cls => {
        const slots = classSlots[cls] ?? [];
        const slot = slots[lessonNumber - 1];
        const prog = classProgress[cls];
        const rowIdx = lessonNumber - 1; // 0-based
        const isPast = !isSkip && slot && slot.date < today;
        const isToday = !isSkip && slot && prog?.todayRowIndices.includes(rowIdx);
        const isNext = !isSkip && !isToday && slot && prog?.nextRowIdx === rowIdx;

        return (
          <td key={cls} className={cn(
            "px-2 py-1.5 text-center text-[10px] w-20 whitespace-nowrap transition-colors",
            isPast && "bg-muted/20",
            isToday && "bg-amber-50 dark:bg-amber-950/20",
            isNext && "bg-green-50 dark:bg-green-950/20",
          )}>
            {slot ? (
              <span className={cn(
                isSkip ? "line-through text-muted-foreground/30" :
                isPast ? "text-muted-foreground/50" :
                isToday ? "text-amber-700 font-semibold dark:text-amber-400" :
                isNext ? "text-green-700 font-semibold dark:text-green-400" :
                "text-foreground",
              )}>
                {isPast && <span className="mr-0.5 text-emerald-500">✓</span>}
                {isToday && <span className="mr-0.5">▶</span>}
                {isNext && !isToday && <span className="mr-0.5 text-green-500">→</span>}
                {slot.date.slice(5).replace("-", "/")} {slot.weekday_jp}{slot.period}
              </span>
            ) : (
              <span className="text-muted-foreground/30">—</span>
            )}
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
      const isSkip = entry?.isSkip ?? false;

      // 実績unitIdが空 → 計画のunitIdにフォールバック
      const overrideUnitId = entry?.unitId ?? "";
      const effectiveUnitId = overrideUnitId || (plannedSlot?.unitId ?? "");
      const isFromPlan = !overrideUnitId && !!plannedSlot?.unitId;

      const unit = effectiveUnitId ? (plan.units.find(u => u.id === effectiveUnitId) ?? null) : null;
      const unitColorIdx = unit ? (unitIndexMap.get(unit.id) ?? 0) : 0;

      // isSkipでない行だけunitPeriodをカウント
      let unitPeriod = 0;
      if (effectiveUnitId && !isSkip) {
        const count = (unitCounts.get(effectiveUnitId) ?? 0) + 1;
        unitCounts.set(effectiveUnitId, count);
        unitPeriod = count;
      }

      return { n, entry, unit, unitColorIdx, effectiveUnitId, unitPeriod, isSkip, isFromPlan };
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

  // 行の前に空行を挿入
  const insertRowBefore = useCallback((lessonNumber: number) => {
    const next = [...plan.lessons];
    while (next.length < lessonNumber - 1) {
      next.push({ id: nanoid(8), unitId: "", unitPeriod: 0, content: "" });
    }
    const emptyEntry: LessonPlanEntry = { id: nanoid(8), unitId: "", unitPeriod: 0, content: "", isSkip: false };
    next.splice(lessonNumber - 1, 0, emptyEntry);
    onUpdateLessons(next);
  }, [plan.lessons, onUpdateLessons]);

  // 行を削除（後ろをつめる）
  const deleteRow = useCallback((lessonNumber: number) => {
    const next = [...plan.lessons];
    if (lessonNumber <= next.length) {
      next.splice(lessonNumber - 1, 1);
    }
    onUpdateLessons(next);
  }, [plan.lessons, onUpdateLessons]);

  // スキップトグル
  const toggleSkip = useCallback((lessonNumber: number) => {
    const next = [...plan.lessons];
    while (next.length < lessonNumber) {
      next.push({ id: nanoid(8), unitId: "", unitPeriod: 0, content: "" });
    }
    const current = next[lessonNumber - 1];
    next[lessonNumber - 1] = { ...current, isSkip: !current.isSkip };
    onUpdateLessons(next);
  }, [plan.lessons, onUpdateLessons]);

  // 今日の日付
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // クラス別進捗（完了数・次回行インデックス・今日の行インデックス）
  const classProgress = useMemo((): Record<string, ClassProgress> => {
    const result: Record<string, ClassProgress> = {};
    for (const cls of classes) {
      const slots = classSlots[cls] ?? [];
      let completedCount = 0;
      const todayRowIndices: number[] = [];
      let nextRowIdx: number | null = null;
      for (let i = 0; i < slots.length; i++) {
        const d = slots[i].date;
        if (d < today) {
          completedCount++;
        } else if (d === today) {
          todayRowIndices.push(i);
        } else {
          if (nextRowIdx === null) nextRowIdx = i;
        }
      }
      // 今日の授業がある場合、nextRowIdx = 今日の最初の行
      const effectiveNext = todayRowIndices.length > 0 ? todayRowIndices[0] : nextRowIdx;
      result[cls] = { completedCount, totalSlots: slots.length, nextRowIdx: effectiveNext, todayRowIndices };
    }
    return result;
  }, [classSlots, classes, today]);

  // クラス間の最大完了数（進捗ギャップ計算用）
  const maxCompleted = useMemo(() =>
    Math.max(0, ...classes.map(c => classProgress[c]?.completedCount ?? 0)),
  [classes, classProgress]);

  const filledCount = plan.lessons.filter(l => l.content && !l.isSkip).length;
  const skipCount = plan.lessons.filter(l => l.isSkip).length;

  return (
    <div className="space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <span className="font-semibold text-foreground text-sm">{plan.grade} {plan.subject}</span>
        <span>全{maxSlots}コマ</span>
        {plannedRows.length > 0 && (
          <span className="text-blue-600/80">計画{plannedRows.length}コマ自動割り振り</span>
        )}
        {filledCount > 0 && <span className="text-emerald-600">{filledCount}コマ入力済み</span>}
        {skipCount > 0 && <span className="text-orange-500">{skipCount}コマ実施なし</span>}
        <span>対象クラス: {classes.join("・")}</span>
      </div>

      {/* 単元管理 */}
      <div className="border border-border rounded-md">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/30"
          onClick={() => setShowUnits(!showUnits)}
        >
          <span className="flex items-center gap-1.5">
            <GripVertical size={11} className="text-muted-foreground" />
            単元管理
            {plan.units.length > 0 && (
              <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">{plan.units.length}件</span>
            )}
            {plan.units.length === 0 && (
              <span className="text-[10px] text-muted-foreground/60">（単元を追加すると各コマに割り当てられます）</span>
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
              ▶ = 今日　→ = 次回　✓ = 済み
            </span>
          )}
        </div>
      )}

      {/* 操作ヒント */}
      <p className="text-[10px] text-muted-foreground/60 -mt-1">
        No.をクリック → 実施なし切替 ／ 行にホバー → 行の挿入・削除 ／ 単元セルをクリック → 単元割り当て
      </p>

      {/* テーブル */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground border-b border-border">
              <th className="px-1 py-2 text-center w-12 font-medium">No.</th>
              <th className="px-2 py-2 w-32 font-medium">単元</th>
              <th className="px-2 py-2 text-center w-10 font-medium">単元内</th>
              <th className="px-2 py-2 min-w-[160px] font-medium">内容予定</th>
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
                          {prog.completedCount}/{prog.totalSlots}完了
                        </span>
                      )}
                      {gap > 0 && (
                        <span className="text-[9px] text-orange-500 font-normal">-{gap}遅れ</span>
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
                  時間割にデータがありません。週間時間割でコマを追加すると自動で表示されます。
                </td>
              </tr>
            ) : (
              rows.map(({ n, entry, unit, unitColorIdx, unitPeriod, effectiveUnitId, isFromPlan, isSkip }) => (
                <LessonRow
                  key={n}
                  lessonNumber={n}
                  contentIndex={n}
                  entry={entry}
                  unit={unit}
                  unitColorIdx={unitColorIdx}
                  unitPeriod={unitPeriod}
                  effectiveUnitId={effectiveUnitId}
                  isFromPlan={isFromPlan}
                  units={plan.units}
                  classSlots={classSlots}
                  classes={classes}
                  isSkip={isSkip}
                  today={today}
                  classProgress={classProgress}
                  onSave={(saved) => updateLesson(n, saved)}
                  onToggleSkip={() => toggleSkip(n)}
                  onInsertBefore={() => insertRowBefore(n)}
                  onDelete={() => deleteRow(n)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {maxSlots > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 text-muted-foreground"
          onClick={() => insertRowBefore(maxSlots + 1)}
        >
          <Plus size={10} /> 末尾に行を追加
        </Button>
      )}
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
          <DialogTitle className="text-sm font-semibold">手動で学年×教科を追加</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">時間割に存在しない組み合わせを手動で追加します</p>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">学年（例: 5年）</Label>
            <Input value={grade} onChange={e => setGrade(e.target.value)} className="h-8 text-xs" placeholder="5年" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">教科（例: 理科）</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} className="h-8 text-xs" placeholder="理科"
              onKeyDown={e => e.key === "Enter" && handleCreate()} />
          </div>
          {alreadyExists && <p className="text-xs text-destructive">この組み合わせはすでに存在します</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-xs">キャンセル</Button>
          <Button size="sm" onClick={handleCreate} disabled={!grade.trim() || !subject.trim() || alreadyExists} className="h-7 text-xs">追加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── メインView ───────────────────────────────────────────────

export function TeachingPlanView() {
  const {
    effectiveEntries,
    teachingPlans,
    upsertTeachingPlan,
    removeTeachingPlan,
    isLoaded,
  } = useTimetable();

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
        ファイルを読み込んでください
      </div>
    );
  }

  const allSidebarItems = [
    ...combos.map(c => ({ id: `${c.grade}|||${c.subject}`, grade: c.grade, subject: c.subject, fromTimetable: true })),
    ...manualOnlyPlans.map(p => ({ id: p.id, grade: p.grade, subject: p.subject, fromTimetable: false })),
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── 左サイドバー ── */}
      <div className="w-48 shrink-0 border-r border-border flex flex-col bg-muted/10">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">学年 × 教科</span>
          <span className="text-[10px] text-muted-foreground">{allSidebarItems.length}件</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {allSidebarItems.length === 0 ? (
            <div className="px-3 py-6 text-xs text-muted-foreground text-center">
              <BookOpen size={20} className="mx-auto mb-2 opacity-30" />
              時間割に教科データがありません
            </div>
          ) : (
            allSidebarItems.map(item => {
              const hasPlan = planMap.has(item.id);
              const plan = planMap.get(item.id);
              const filledCount = plan?.lessons.filter(l => l.content && !l.isSkip).length ?? 0;
              const skipCount = plan?.lessons.filter(l => l.isSkip).length ?? 0;
              const totalCount = slotCountMap.get(item.id) ?? 0;
              const isSelected = selectedId === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors",
                    isSelected
                      ? "bg-primary/10 border-l-2 border-l-primary"
                      : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={cn("text-xs font-medium truncate", isSelected ? "text-foreground" : "text-muted-foreground")}>
                      {item.grade} {item.subject}
                    </span>
                    {hasPlan && filledCount > 0 && (
                      <span className="text-[9px] bg-emerald-100 text-emerald-700 rounded px-1 shrink-0">
                        {filledCount}/{totalCount}
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-0.5 flex gap-1.5">
                    {item.fromTimetable && <span>{totalCount}コマ</span>}
                    {skipCount > 0 && <span className="text-orange-500">{skipCount}回スキップ</span>}
                    {!hasPlan && item.fromTimetable && <span className="opacity-50">未入力</span>}
                    {!item.fromTimetable && <span className="opacity-50">手動追加</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="p-2 border-t border-border">
          <Button
            size="sm"
            variant="ghost"
            className="w-full h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setShowManualAdd(true)}
          >
            <Plus size={11} />手動で追加
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
                  <Trash2 size={11} />この指導計画のデータを削除
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <FileText size={32} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">左から学年×教科を選択してください</p>
          </div>
        )}
      </div>

      <ManualAddDialog
        open={showManualAdd}
        onClose={() => setShowManualAdd(false)}
        onCreate={(plan) => { upsertTeachingPlan(plan); setSelectedId(plan.id); }}
        existingIds={existingIds}
      />

      <Dialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">指導計画データを削除しますか？</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground py-2">
            入力した授業内容・単元データがすべて削除されます。この操作は取り消せません。
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)} className="h-7 text-xs">キャンセル</Button>
            <Button
              variant="destructive" size="sm" className="h-7 text-xs"
              onClick={() => {
                if (confirmDeleteId) {
                  removeTeachingPlan(confirmDeleteId);
                  if (selectedId === confirmDeleteId) setSelectedId(null);
                }
                setConfirmDeleteId(null);
              }}
            >削除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
