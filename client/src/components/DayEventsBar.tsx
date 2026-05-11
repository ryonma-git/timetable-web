// DayEventsBar.tsx
// v91: 週間時間割の上に表示する日次予定欄
// その日に予定されている全イベント（コマ影響の有無に関わらず）を表示・編集

import { useState, useMemo } from "react";
import { nanoid } from "nanoid";
import { useTimetable } from "@/contexts/TimetableContext";
import {
  buildAddDayEventOp,
  buildRemoveDayEventOp,
  buildUpdateDayEventOp,
  DailyEvent,
  TimetableEntry,
} from "@/lib/timetable";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X, Pencil, Calendar, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// カテゴリ別の色（ライト系・控えめに）
const CATEGORY_STYLES: Record<NonNullable<DailyEvent["category"]>, string> = {
  ceremony: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
  event:    "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
  meeting:  "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
  drill:    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  holiday:  "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  other:    "bg-muted text-muted-foreground border-border",
};

const CATEGORY_LABELS: Record<NonNullable<DailyEvent["category"]>, string> = {
  ceremony: "式典",
  event:    "行事",
  meeting:  "会議",
  drill:    "訓練",
  holiday:  "休日",
  other:    "その他",
};

function getCategoryStyle(category: DailyEvent["category"]) {
  return CATEGORY_STYLES[category ?? "other"];
}

// ─── 個別イベントの編集ポップアップ ─────────────────────────────────
interface EventEditorProps {
  date: string;
  event: DailyEvent | null;       // null = 新規追加
  onClose: () => void;
}

function EventEditor({ date, event, onClose }: EventEditorProps) {
  const { applyOps } = useTimetable();
  const [title, setTitle] = useState(event?.title ?? "");
  const [category, setCategory] = useState<NonNullable<DailyEvent["category"]>>(
    event?.category ?? "other"
  );
  const [notes, setNotes] = useState(event?.notes ?? "");

  const isNew = event === null;

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (isNew) {
      const newEvent: DailyEvent = {
        id: nanoid(8),
        title: trimmed,
        category,
        notes: notes.trim() || undefined,
      };
      applyOps([buildAddDayEventOp(date, newEvent)], `予定を追加: ${trimmed}`);
    } else {
      const updated: DailyEvent = {
        ...event,
        title: trimmed,
        category,
        notes: notes.trim() || undefined,
      };
      applyOps([buildUpdateDayEventOp(date, event.id, updated)], `予定を更新: ${trimmed}`);
    }
    onClose();
  };

  const remove = () => {
    if (!event) return;
    applyOps([buildRemoveDayEventOp(date, event.id)], `予定を削除: ${event.title}`);
    onClose();
  };

  return (
    <div className="space-y-2">
      <Input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="予定の内容（例: 職員会議）"
        className="h-7 text-xs"
        autoFocus
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
      />
      <div className="flex flex-wrap gap-1">
        {(Object.keys(CATEGORY_LABELS) as Array<NonNullable<DailyEvent["category"]>>).map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
              category === c ? getCategoryStyle(c) + " ring-1 ring-current" : "text-muted-foreground border-border hover:bg-muted/50",
            )}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <Input
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="メモ（任意）"
        className="h-6 text-[11px]"
      />
      <div className="flex justify-between gap-2 pt-1">
        {!isNew && (
          <Button variant="ghost" size="sm" className="h-6 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10" onClick={remove}>
            <X size={11} className="mr-0.5" />削除
          </Button>
        )}
        <div className="flex gap-1 ml-auto">
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClose}>キャンセル</Button>
          <Button size="sm" className="h-6 text-[11px]" onClick={save} disabled={!title.trim()}>
            <Check size={11} className="mr-0.5" />{isNew ? "追加" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── 日のイベントセル（チップ一覧＋追加ボタン） ──────────────────────────
interface DayEventsCellProps {
  date: string;
  events: DailyEvent[];
}

function DayEventsCell({ date, events }: DayEventsCellProps) {
  const [editing, setEditing] = useState<{ event: DailyEvent | null } | null>(null);

  return (
    <div className="flex flex-wrap gap-0.5 items-start min-h-[20px] py-1">
      {events.map(ev => (
        <Popover
          key={ev.id}
          open={editing?.event?.id === ev.id}
          onOpenChange={(open) => setEditing(open ? { event: ev } : null)}
        >
          <PopoverTrigger asChild>
            <button
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border font-medium leading-tight truncate max-w-[120px] hover:opacity-80 transition-opacity",
                getCategoryStyle(ev.category),
              )}
              title={`${ev.title}${ev.notes ? ` — ${ev.notes}` : ""}`}
            >
              {ev.title}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
              <Pencil size={9} />予定を編集 — {date}
            </p>
            <EventEditor date={date} event={ev} onClose={() => setEditing(null)} />
          </PopoverContent>
        </Popover>
      ))}
      <Popover
        open={editing?.event === null}
        onOpenChange={(open) => setEditing(open ? { event: null } : null)}
      >
        <PopoverTrigger asChild>
          <button
            className={cn(
              "text-[10px] px-1 py-0.5 rounded border border-dashed text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 transition-colors",
              events.length === 0 && "flex items-center gap-0.5",
            )}
            title="予定を追加"
          >
            <Plus size={10} />
            {events.length === 0 && <span className="text-[9px]">予定</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <Calendar size={9} />予定を追加 — {date}
          </p>
          <EventEditor date={date} event={null} onClose={() => setEditing(null)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── 週間予定バー（WeekGridの上部に表示） ─────────────────────────────
interface DayEventsBarProps {
  weekDates: string[];   // YYYY-MM-DD文字列の配列
  className?: string;
}

export function DayEventsBar({ weekDates, className }: DayEventsBarProps) {
  const { effectiveEntries } = useTimetable();

  const eventsByDate = useMemo(() => {
    const map = new Map<string, DailyEvent[]>();
    for (const entry of effectiveEntries) {
      if (entry.dayEvents && entry.dayEvents.length > 0) {
        map.set(entry.date, entry.dayEvents);
      }
    }
    return map;
  }, [effectiveEntries]);

  const totalCount = useMemo(() => {
    let n = 0;
    for (const d of weekDates) {
      n += eventsByDate.get(d)?.length ?? 0;
    }
    return n;
  }, [weekDates, eventsByDate]);

  // 日付文字列から月日・曜日を取得
  const parseDateStr = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    const weekday = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return { month: d.getMonth() + 1, day: d.getDate(), weekday };
  };

  return (
    <div className={cn("border border-border rounded-md bg-muted/10", className)}>
      <div className="flex items-center px-2 py-1 border-b border-border/40 bg-muted/20">
        <Calendar size={11} className="text-muted-foreground mr-1.5" />
        <span className="text-[10px] font-medium text-muted-foreground">この週の予定</span>
        {totalCount > 0 && (
          <span className="text-[9px] text-muted-foreground/70 ml-1.5">（{totalCount}件）</span>
        )}
        <span className="text-[9px] text-muted-foreground/50 ml-auto">クリックで編集・+ で追加</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${weekDates.length}, minmax(0, 1fr))` }}>
        {weekDates.map((dateStr) => {
          const events = eventsByDate.get(dateStr) ?? [];
          const { month, day, weekday } = parseDateStr(dateStr);
          return (
            <div key={dateStr} className="px-1.5 py-0.5 border-r border-border/30 last:border-r-0 min-h-[28px]">
              <div className="text-[9px] text-muted-foreground mb-0.5">
                {month}/{day}（{weekday}）
              </div>
              <DayEventsCell date={dateStr} events={events} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ヘルパ: TimetableEntry[] から特定日のイベント取得（外部利用用）
export function getEventsForDate(entries: TimetableEntry[], date: string): DailyEvent[] {
  return entries.find(e => e.date === date)?.dayEvents ?? [];
}
