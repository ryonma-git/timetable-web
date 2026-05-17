// DayEventsBar.tsx
// v91: 週間時間割の上に表示する日次予定欄
// v93: カスタムカテゴリ対応（既定6種＋任意文字列、文字列ハッシュで自動カラー割り当て）

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
import { useLanguage, type TranslationKey } from "@/contexts/LanguageContext";

type TFn = (k: TranslationKey) => string;
const tfmt = (t: TFn, key: TranslationKey, vars: Record<string, string | number>) => {
  let s: string = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
};

// ─── 既定カテゴリ（既知のラベル・色・ヒントを持つ） ─────────────────────
const BUILTIN_CATEGORIES = ["ceremony", "event", "work", "student", "holiday", "other"] as const;
type BuiltinCategory = typeof BUILTIN_CATEGORIES[number];
const BUILTIN_KEYS = new Set<string>(BUILTIN_CATEGORIES);

const CATEGORY_STYLES: Record<BuiltinCategory, string> = {
  ceremony: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
  event:    "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
  work:     "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
  student:  "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  holiday:  "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  other:    "bg-muted text-muted-foreground border-border",
};

// カテゴリのラベル/ヒントは i18n 辞書から取得（dayEvents.cat.* / dayEvents.hint.*）
function catLabel(t: TFn, c: BuiltinCategory): string {
  return t(`dayEvents.cat.${c}` as TranslationKey);
}
function catHint(t: TFn, c: BuiltinCategory): string {
  return t(`dayEvents.hint.${c}` as TranslationKey);
}

// ─── カスタムカテゴリ用パレット（既定6色と被らないトーン） ────────────────
const CUSTOM_PALETTE = [
  "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800",
  "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800",
  "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800",
  "bg-lime-100 text-lime-800 border-lime-200 dark:bg-lime-900/30 dark:text-lime-300 dark:border-lime-800",
  "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800",
  "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-300 dark:border-fuchsia-800",
  "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800",
  "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) >>> 0;
  return h;
}

function getCategoryStyle(category?: string): string {
  if (!category) return CATEGORY_STYLES.other;
  if (BUILTIN_KEYS.has(category)) return CATEGORY_STYLES[category as BuiltinCategory];
  return CUSTOM_PALETTE[hashString(category) % CUSTOM_PALETTE.length];
}

function getCategoryLabel(t: TFn, category?: string): string {
  if (!category) return catLabel(t, "other");
  if (BUILTIN_KEYS.has(category)) return catLabel(t, category as BuiltinCategory);
  return category; // カスタムタグはそのまま表示
}

// ─── 個別イベントの編集ポップアップ ─────────────────────────────────
interface EventEditorProps {
  date: string;
  event: DailyEvent | null;       // null = 新規追加
  onClose: () => void;
}

function EventEditor({ date, event, onClose }: EventEditorProps) {
  const { applyOps, effectiveEntries } = useTimetable();
  const { t } = useLanguage();
  const [title, setTitle] = useState(event?.title ?? "");
  const [category, setCategory] = useState<string>(event?.category ?? "other");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState("");

  const isNew = event === null;

  // このファイル内に既出のカスタムカテゴリを収集
  const knownCustomCategories = useMemo(() => {
    const set = new Set<string>();
    for (const entry of effectiveEntries) {
      for (const ev of entry.dayEvents ?? []) {
        if (ev.category && !BUILTIN_KEYS.has(ev.category)) {
          set.add(ev.category);
        }
      }
    }
    return Array.from(set).sort();
  }, [effectiveEntries]);

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

  const commitCustomCategory = () => {
    const trimmed = customInput.trim();
    if (!trimmed) {
      setCustomMode(false);
      return;
    }
    // 予約語"other"等と被るのを避ける
    if (BUILTIN_KEYS.has(trimmed)) {
      setCategory(trimmed);
    } else {
      setCategory(trimmed);
    }
    setCustomMode(false);
    setCustomInput("");
  };

  const isCustomSelected = !BUILTIN_KEYS.has(category);

  return (
    <div className="space-y-2">
      <Input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={t("dayEvents.contentPlaceholder")}
        className="h-7 text-xs"
        autoFocus
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
      />

      {/* 既定6種 */}
      <div className="flex flex-wrap gap-1">
        {BUILTIN_CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            title={catHint(t, c)}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
              category === c
                ? getCategoryStyle(c) + " ring-1 ring-current"
                : "text-muted-foreground border-border hover:bg-muted/50",
            )}
          >
            {catLabel(t, c)}
          </button>
        ))}
      </div>

      {/* 既出カスタム + 新規追加 */}
      {(knownCustomCategories.length > 0 || customMode || isCustomSelected) && (
        <div className="flex flex-wrap gap-1 items-center pt-1 border-t border-border/30">
          <span className="text-[9px] text-muted-foreground/60 mr-0.5">{t("dayEvents.custom")}</span>
          {knownCustomCategories.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                category === c
                  ? getCategoryStyle(c) + " ring-1 ring-current"
                  : "text-muted-foreground border-border hover:bg-muted/50",
              )}
            >
              {c}
            </button>
          ))}
          {/* 選択中だが既出に無いカスタム（新規追加直後など） */}
          {isCustomSelected && !knownCustomCategories.includes(category) && (
            <button
              onClick={() => {}}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                getCategoryStyle(category) + " ring-1 ring-current",
              )}
            >
              {category}
            </button>
          )}
          {customMode ? (
            <div className="flex items-center gap-0.5">
              <Input
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                placeholder={t("dayEvents.newTagPlaceholder")}
                className="h-5 text-[10px] w-20 px-1"
                autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); commitCustomCategory(); }
                  if (e.key === "Escape") { setCustomMode(false); setCustomInput(""); }
                }}
              />
              <button
                onClick={commitCustomCategory}
                className="text-[10px] text-emerald-600 hover:text-emerald-700"
                title={t("dayEvents.add")}
              >
                <Check size={11} />
              </button>
              <button
                onClick={() => { setCustomMode(false); setCustomInput(""); }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
                title={t("dayEvents.cancel")}
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCustomMode(true)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/30"
              title={t("dayEvents.addCustomCategory")}
            >
              <Plus size={9} className="inline-block mr-0.5" />{t("dayEvents.new")}
            </button>
          )}
        </div>
      )}

      {/* 説明 */}
      <p className="text-[9px] text-muted-foreground/60 -mt-0.5">
        {BUILTIN_KEYS.has(category)
          ? catHint(t, category as BuiltinCategory)
          : tfmt(t, "dayEvents.customTagLabel", { c: category })}
      </p>

      {/* カスタムタグ追加ボタンを既出無しケース用にも */}
      {knownCustomCategories.length === 0 && !customMode && !isCustomSelected && (
        <button
          onClick={() => setCustomMode(true)}
          className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground underline-offset-2 hover:underline"
        >
          {t("dayEvents.addCustomTagLink")}
        </button>
      )}

      <Input
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={t("dayEvents.notePlaceholder")}
        className="h-6 text-[11px]"
      />
      <div className="flex justify-between gap-2 pt-1">
        {!isNew && (
          <Button variant="ghost" size="sm" className="h-6 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10" onClick={remove}>
            <X size={11} className="mr-0.5" />{t("dayEvents.delete")}
          </Button>
        )}
        <div className="flex gap-1 ml-auto">
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClose}>{t("dayEvents.cancel")}</Button>
          <Button size="sm" className="h-6 text-[11px]" onClick={save} disabled={!title.trim()}>
            <Check size={11} className="mr-0.5" />{isNew ? t("dayEvents.add") : t("dayEvents.save")}
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

export function DayEventsCell({ date, events }: DayEventsCellProps) {
  const [editing, setEditing] = useState<{ event: DailyEvent | null } | null>(null);
  const { t } = useLanguage();

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
              title={`${ev.title}${ev.category ? ` [${getCategoryLabel(t, ev.category)}]` : ""}${ev.notes ? ` — ${ev.notes}` : ""}`}
            >
              {ev.title}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start">
            <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
              <Pencil size={9} />{tfmt(t, "dayEvents.editTitle", { date })}
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
            title={t("dayEvents.addEventTitle")}
          >
            <Plus size={10} />
            {events.length === 0 && <span className="text-[9px]">{t("dayEvents.eventsShort")}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <Calendar size={9} />{tfmt(t, "dayEvents.addEventHeader", { date })}
          </p>
          <EventEditor date={date} event={null} onClose={() => setEditing(null)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── 週間予定バー（互換性のため残す。WeekGrid統合後は通常未使用） ─────────
interface DayEventsBarProps {
  weekDates: string[];
  className?: string;
}

export function DayEventsBar({ weekDates, className }: DayEventsBarProps) {
  const { effectiveEntries } = useTimetable();
  const { t } = useLanguage();
  const weekdayNames = t("dayEvents.weekdays").split(",");

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
    for (const d of weekDates) n += eventsByDate.get(d)?.length ?? 0;
    return n;
  }, [weekDates, eventsByDate]);

  const parseDateStr = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    const weekday = weekdayNames[d.getDay()] ?? "";
    return { month: d.getMonth() + 1, day: d.getDate(), weekday };
  };

  return (
    <div className={cn("border border-border rounded-md bg-muted/10", className)}>
      <div className="flex items-center px-2 py-1 border-b border-border/40 bg-muted/20">
        <Calendar size={11} className="text-muted-foreground mr-1.5" />
        <span className="text-[10px] font-medium text-muted-foreground">{t("dayEvents.weekEvents")}</span>
        {totalCount > 0 && (
          <span className="text-[9px] text-muted-foreground/70 ml-1.5">{tfmt(t, "dayEvents.countSuffix", { n: totalCount })}</span>
        )}
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
