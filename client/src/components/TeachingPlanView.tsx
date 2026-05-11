// TeachingPlanView.tsx
// 指導計画画面：学年×教科単位で、通し番号・単元・内容予定・クラス別実施日を管理する

import { useState, useMemo, useCallback } from "react";
import { nanoid } from "nanoid";
import { useTimetable } from "@/contexts/TimetableContext";
import { GradeSubjectPlan, TeachingUnit, LessonPlanEntry } from "@/lib/timetableFile";
import { TimetableEntry } from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, BookOpen, ChevronDown, Pencil, Check, X, GripVertical,
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

/** クラス×教科で有効な授業スロットを日付順に返す */
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

/** 有効エントリから学年・教科の組み合わせ一覧を抽出 */
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
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-amber-100 text-amber-800",
  "bg-purple-100 text-purple-800",
  "bg-rose-100 text-rose-800",
  "bg-cyan-100 text-cyan-800",
  "bg-orange-100 text-orange-800",
  "bg-teal-100 text-teal-800",
];

function getUnitColor(idx: number) {
  return UNIT_COLORS[idx % UNIT_COLORS.length];
}

// ─── 新規指導計画作成ダイアログ ───────────────────────────────

interface NewPlanDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (plan: GradeSubjectPlan) => void;
  combos: Array<{ grade: string; subject: string; classes: string[] }>;
  existingIds: Set<string>;
}

function NewPlanDialog({ open, onClose, onCreate, combos, existingIds }: NewPlanDialogProps) {
  const [grade, setGrade] = useState(combos[0]?.grade ?? "");
  const [subject, setSubject] = useState(combos[0]?.subject ?? "");
  const [customGrade, setCustomGrade] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [useCustom, setUseCustom] = useState(combos.length === 0);

  const finalGrade = useCustom ? customGrade : grade;
  const finalSubject = useCustom ? customSubject : subject;
  const planId = `${finalGrade}|||${finalSubject}`;
  const alreadyExists = existingIds.has(planId);

  const handleCreate = () => {
    if (!finalGrade || !finalSubject || alreadyExists) return;
    onCreate({
      id: planId,
      grade: finalGrade,
      subject: finalSubject,
      units: [],
      lessons: [],
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">指導計画を新規作成</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {combos.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                className={cn("text-xs px-2 py-1 rounded border", !useCustom ? "bg-primary text-primary-foreground border-primary" : "border-border")}
                onClick={() => setUseCustom(false)}
              >時間割から選択</button>
              <button
                className={cn("text-xs px-2 py-1 rounded border", useCustom ? "bg-primary text-primary-foreground border-primary" : "border-border")}
                onClick={() => setUseCustom(true)}
              >手動入力</button>
            </div>
          )}
          {!useCustom && combos.length > 0 ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">学年</Label>
                <select
                  className="w-full h-8 text-xs border border-border rounded px-2 bg-background"
                  value={grade}
                  onChange={e => { setGrade(e.target.value); setSubject(""); }}
                >
                  {Array.from(new Set(combos.map(c => c.grade))).map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">教科</Label>
                <select
                  className="w-full h-8 text-xs border border-border rounded px-2 bg-background"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                >
                  {combos.filter(c => c.grade === grade).map(c => (
                    <option key={c.subject} value={c.subject}>{c.subject}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">学年（例: 5年）</Label>
                <Input value={customGrade} onChange={e => setCustomGrade(e.target.value)} className="h-8 text-xs" placeholder="5年" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">教科（例: 理科）</Label>
                <Input value={customSubject} onChange={e => setCustomSubject(e.target.value)} className="h-8 text-xs" placeholder="理科" />
              </div>
            </>
          )}
          {alreadyExists && <p className="text-xs text-destructive">この学年・教科の指導計画はすでに存在します</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-xs">キャンセル</Button>
          <Button size="sm" onClick={handleCreate} disabled={!finalGrade || !finalSubject || alreadyExists} className="h-7 text-xs">作成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 単元編集ダイアログ ────────────────────────────────────────

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

  return (
    <div className="space-y-1">
      {units.map((u, idx) => (
        <div key={u.id} className="flex items-center gap-2 group">
          <GripVertical size={12} className="text-muted-foreground shrink-0" />
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", getUnitColor(idx))}>
            {idx + 1}
          </span>
          {editingId === u.id ? (
            <>
              <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-6 text-xs flex-1" autoFocus onKeyDown={e => e.key === "Enter" && commitEdit(u.id)} />
              <Input value={editPeriods} onChange={e => setEditPeriods(e.target.value)} className="h-6 text-xs w-14" type="number" min={1} />
              <span className="text-xs text-muted-foreground shrink-0">コマ</span>
              <button onClick={() => commitEdit(u.id)} className="text-green-600 hover:text-green-700"><Check size={12} /></button>
              <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </>
          ) : (
            <>
              <span className="text-xs flex-1 truncate">{u.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{u.plannedPeriods}コマ</span>
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

// ─── レッスン行（インライン編集） ────────────────────────────────

interface LessonRowProps {
  lessonNumber: number;
  entry: LessonPlanEntry | null;
  unit: TeachingUnit | null;
  unitColorIdx: number;
  classSlots: Record<string, Array<{ date: string; period: number; weekday_jp: string }>>;
  classes: string[];
  onSave: (entry: LessonPlanEntry) => void;
  planId: string;
  unitId: string;
  unitPeriod: number;
}

function LessonRow({
  lessonNumber, entry, unit, unitColorIdx, classSlots, classes, onSave, planId, unitId, unitPeriod,
}: LessonRowProps) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(entry?.content ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");

  const commit = () => {
    onSave({
      id: entry?.id ?? nanoid(8),
      unitId,
      unitPeriod,
      content: content.trim(),
      notes: notes.trim() || undefined,
    });
    setEditing(false);
  };

  const cancel = () => {
    setContent(entry?.content ?? "");
    setNotes(entry?.notes ?? "");
    setEditing(false);
  };

  return (
    <tr className={cn("border-b border-border/40 hover:bg-muted/20 group", editing && "bg-muted/30")}>
      {/* 通し番号 */}
      <td className="px-2 py-1.5 text-center text-xs text-muted-foreground font-mono w-8 shrink-0">
        {lessonNumber}
      </td>
      {/* 単元 */}
      <td className="px-2 py-1.5 w-28">
        {unit ? (
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", getUnitColor(unitColorIdx))}>
            {unit.name}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">-</span>
        )}
      </td>
      {/* 単元内 */}
      <td className="px-2 py-1.5 text-center text-xs text-muted-foreground w-10">
        {unitPeriod}
      </td>
      {/* 内容予定 */}
      <td className="px-2 py-1.5 min-w-[140px]">
        {editing ? (
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
            className="flex items-center gap-1 cursor-pointer"
            onClick={() => { setContent(entry?.content ?? ""); setNotes(entry?.notes ?? ""); setEditing(true); }}
          >
            <span className={cn("text-xs", entry?.content ? "text-foreground" : "text-muted-foreground/50 italic")}>
              {entry?.content || "（未入力）"}
            </span>
            <Pencil size={10} className="opacity-0 group-hover:opacity-60 text-muted-foreground shrink-0" />
          </div>
        )}
      </td>
      {/* クラス別日付 */}
      {classes.map(cls => {
        const slots = classSlots[cls] ?? [];
        const slot = slots[lessonNumber - 1];
        return (
          <td key={cls} className="px-2 py-1.5 text-center text-[10px] w-20">
            {slot ? (
              <span className="text-foreground">
                {slot.date.slice(5).replace("-", "/")} {slot.weekday_jp}{slot.period}
              </span>
            ) : (
              <span className="text-muted-foreground/40">実施なし</span>
            )}
          </td>
        );
      })}
    </tr>
  );
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

  // クラス別コマスロットをメモ化
  const classSlots = useMemo(() => {
    const result: Record<string, Array<{ date: string; period: number; weekday_jp: string }>> = {};
    for (const cls of classes) {
      result[cls] = computeClassLessonSlots(effectiveEntries, cls, plan.subject);
    }
    return result;
  }, [effectiveEntries, classes, plan.subject]);

  // 全クラスの最大コマ数 → 行数を決定
  const maxSlots = useMemo(() => {
    return Math.max(
      plan.lessons.length,
      ...classes.map(cls => (classSlots[cls] ?? []).length),
    );
  }, [classSlots, classes, plan.lessons.length]);

  // 単元→インデックスマップ（カラー用）
  const unitIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    plan.units.forEach((u, i) => m.set(u.id, i));
    return m;
  }, [plan.units]);

  // 行ごとの単元・unitPeriodを計算
  // lessons配列にないスロット番号（N > lessons.length）はnullエントリとして表示
  const rows = useMemo(() => {
    const result = [];
    // lessonをunitId→単元内カウントでグループ化して表示
    // 単元割り当てのないスロットはnull扱い
    const lessonsByNum = new Map<number, LessonPlanEntry>();
    plan.lessons.forEach((l, i) => lessonsByNum.set(i + 1, l));

    for (let n = 1; n <= maxSlots; n++) {
      const entry = lessonsByNum.get(n) ?? null;
      const unit = entry ? (plan.units.find(u => u.id === entry.unitId) ?? null) : null;
      const unitColorIdx = unit ? (unitIndexMap.get(unit.id) ?? 0) : 0;
      result.push({ n, entry, unit, unitColorIdx, unitId: entry?.unitId ?? "", unitPeriod: entry?.unitPeriod ?? n });
    }
    return result;
  }, [maxSlots, plan.lessons, plan.units, unitIndexMap]);

  const handleSaveLesson = useCallback((lessonNumber: number, saved: LessonPlanEntry) => {
    const next = [...plan.lessons];
    // 足りない行を埋める
    while (next.length < lessonNumber) {
      next.push({ id: nanoid(8), unitId: "", unitPeriod: next.length + 1, content: "" });
    }
    next[lessonNumber - 1] = saved;
    onUpdateLessons(next);
  }, [plan.lessons, onUpdateLessons]);

  return (
    <div className="space-y-3">
      {/* 単元管理パネル */}
      <div className="border border-border rounded-md">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/30"
          onClick={() => setShowUnits(!showUnits)}
        >
          <span>単元管理（{plan.units.length}件）</span>
          <ChevronDown size={12} className={cn("transition-transform", showUnits && "rotate-180")} />
        </button>
        {showUnits && (
          <div className="px-3 py-2 border-t border-border">
            <UnitEditor units={plan.units} onChange={onUpdateUnits} />
          </div>
        )}
      </div>

      {/* 授業計画テーブル */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground">
              <th className="px-2 py-2 text-center w-8 font-medium">No.</th>
              <th className="px-2 py-2 w-28 font-medium">単元</th>
              <th className="px-2 py-2 text-center w-10 font-medium">単元内</th>
              <th className="px-2 py-2 min-w-[140px] font-medium">内容予定</th>
              {classes.map(cls => (
                <th key={cls} className="px-2 py-2 text-center w-20 font-medium">{cls}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4 + classes.length} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  時間割にデータがありません。授業コマを追加すると自動で表示されます。
                </td>
              </tr>
            ) : (
              rows.map(({ n, entry, unit, unitColorIdx, unitId, unitPeriod }) => (
                <LessonRow
                  key={n}
                  lessonNumber={n}
                  entry={entry}
                  unit={unit}
                  unitColorIdx={unitColorIdx}
                  classSlots={classSlots}
                  classes={classes}
                  onSave={(saved) => handleSaveLesson(n, saved)}
                  planId={plan.id}
                  unitId={unitId}
                  unitPeriod={unitPeriod}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {maxSlots > 0 && (
        <p className="text-[10px] text-muted-foreground">
          全{maxSlots}コマ　内容入力済み: {plan.lessons.filter(l => l.content).length}コマ
        </p>
      )}
    </div>
  );
}

// ─── メインView ───────────────────────────────────────────────

export function TeachingPlanView() {
  const {
    effectiveEntries,
    teachingPlans,
    upsertTeachingPlan,
    removeTeachingPlan,
    updateTeachingPlanLessons,
    updateTeachingPlanUnits,
    isLoaded,
  } = useTimetable();

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 時間割から学年×教科の組み合わせを抽出
  const combos = useMemo(() => extractGradeSubjectCombos(effectiveEntries), [effectiveEntries]);
  const existingIds = useMemo(() => new Set(teachingPlans.map(p => p.id)), [teachingPlans]);

  // 選択中のplan
  const activePlan = teachingPlans.find(p => p.id === selectedPlanId) ?? teachingPlans[0] ?? null;
  const activeId = activePlan?.id ?? null;

  // activePlanに対応するクラスリスト
  const activePlanClasses = useMemo(() => {
    if (!activePlan) return [];
    return combos.find(c => c.grade === activePlan.grade && c.subject === activePlan.subject)?.classes ?? [];
  }, [activePlan, combos]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        ファイルを読み込んでください
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 shrink-0">
        <BookOpen size={14} className="text-muted-foreground" />
        <span className="text-sm font-semibold">指導計画</span>
        <span className="text-xs text-muted-foreground ml-1">（教科担任モード）</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => setNewPlanOpen(true)}
        >
          <Plus size={11} />
          新規作成
        </Button>
      </div>

      {/* タブ（学年×教科） */}
      {teachingPlans.length > 0 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-muted/10 overflow-x-auto shrink-0">
          {teachingPlans.map(plan => (
            <div key={plan.id} className="flex items-center group shrink-0">
              <button
                onClick={() => setSelectedPlanId(plan.id)}
                className={cn(
                  "px-3 py-1 text-xs rounded-t font-medium transition-colors",
                  plan.id === activeId
                    ? "bg-background text-foreground border border-b-background border-border -mb-px z-10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {plan.grade} {plan.subject}
              </button>
              <button
                onClick={() => setConfirmDeleteId(plan.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all ml-0.5"
                title="削除"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* コンテンツ */}
      <div className="flex-1 overflow-auto p-4">
        {teachingPlans.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <BookOpen size={32} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">指導計画がまだありません</p>
            <p className="text-xs text-muted-foreground">
              「新規作成」で学年×教科の指導計画を追加してください。<br />
              時間割データから授業コマ数が自動計算されます。
            </p>
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setNewPlanOpen(true)}>
              <Plus size={11} />
              指導計画を新規作成
            </Button>
          </div>
        ) : activePlan ? (
          <PlanTable
            key={activePlan.id}
            plan={activePlan}
            classes={activePlanClasses}
            effectiveEntries={effectiveEntries}
            onUpdateLessons={(lessons) => updateTeachingPlanLessons(activePlan.id, lessons)}
            onUpdateUnits={(units) => updateTeachingPlanUnits(activePlan.id, units)}
          />
        ) : null}
      </div>

      {/* 新規作成ダイアログ */}
      <NewPlanDialog
        open={newPlanOpen}
        onClose={() => setNewPlanOpen(false)}
        onCreate={(plan) => { upsertTeachingPlan(plan); setSelectedPlanId(plan.id); }}
        combos={combos}
        existingIds={existingIds}
      />

      {/* 削除確認ダイアログ */}
      <Dialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">指導計画を削除しますか？</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground py-2">
            入力した授業内容がすべて削除されます。この操作は取り消せません。
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)} className="h-7 text-xs">キャンセル</Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                if (confirmDeleteId) {
                  removeTeachingPlan(confirmDeleteId);
                  if (selectedPlanId === confirmDeleteId) setSelectedPlanId(null);
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
