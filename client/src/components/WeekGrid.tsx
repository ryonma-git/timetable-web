// WeekGrid.tsx
// Design: Swiss Grid × Japanese Functional Design
// Week grid with drag-and-drop, today highlight, class color coding

import { useState } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { buildSwapOps, formatDateJP, getWeekDates, PeriodSlot, TimetableEntry, todayISO } from "@/lib/timetable";
import { cn } from "@/lib/utils";

const PERIOD_LABELS = ["", "1限", "2限", "3限", "4限", "5限", "6限"];

// Class color mapping by grade - using CSS variables to avoid dark mode interference
function getClassColor(cls: string | null): { style: React.CSSProperties; textStyle: React.CSSProperties } {
  if (!cls) return {
    style: { backgroundColor: 'var(--empty-bg)', borderColor: 'var(--border)' },
    textStyle: { color: 'var(--muted-foreground)', opacity: 0.4 }
  };
  if (cls.startsWith("4年")) return {
    style: { backgroundColor: 'var(--grade4-bg)', borderColor: 'var(--grade4-border)' },
    textStyle: { color: 'var(--grade4-text)' }
  };
  if (cls.startsWith("5年")) return {
    style: { backgroundColor: 'var(--grade5-bg)', borderColor: 'var(--grade5-border)' },
    textStyle: { color: 'var(--grade5-text)' }
  };
  if (cls.startsWith("6年")) return {
    style: { backgroundColor: 'var(--grade6-bg)', borderColor: 'var(--grade6-border)' },
    textStyle: { color: 'var(--grade6-text)' }
  };
  return {
    style: { backgroundColor: 'var(--special-bg)', borderColor: 'var(--special-border)' },
    textStyle: { color: 'var(--special-text)' }
  };
}

interface DragState {
  srcDate: string;
  srcPeriod: number;
  srcClass: string | null;
}

export function WeekGrid() {
  const {
    effectiveEntries,
    currentWeekMonday,
    selectedCell, setSelectedCell,
    applyOps,
    isLoaded,
  } = useTimetable();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOver, setDragOver] = useState<{ date: string; period: number } | null>(null);
  const today = todayISO();

  const weekDates = getWeekDates(currentWeekMonday);

  // Build lookup: date -> entry
  const entryByDate = new Map<string, TimetableEntry>();
  effectiveEntries.forEach(e => entryByDate.set(e.date, e));

  const getSlot = (date: string, period: number): PeriodSlot => {
    const entry = entryByDate.get(date);
    if (!entry) return { period, class: null };
    return entry.periods.find(p => p.period === period) ?? { period, class: null };
  };

  // ─── Drag Handlers ────────────────────────────────────────────
  const handleDragStart = (date: string, period: number, cls: string | null) => {
    setDragState({ srcDate: date, srcPeriod: period, srcClass: cls });
  };

  const handleDragOver = (e: React.DragEvent, date: string, period: number) => {
    e.preventDefault();
    setDragOver({ date, period });
  };

  const handleDrop = (e: React.DragEvent, dstDate: string, dstPeriod: number) => {
    e.preventDefault();
    if (!dragState) return;
    const { srcDate, srcPeriod, srcClass } = dragState;
    if (srcDate === dstDate && srcPeriod === dstPeriod) {
      setDragState(null);
      setDragOver(null);
      return;
    }

    const dstSlot = getSlot(dstDate, dstPeriod);
    const dstClass = dstSlot.class;

    // Swap
    const ops = buildSwapOps(srcDate, srcPeriod, srcClass, dstDate, dstPeriod, dstClass);
    applyOps(ops, `交換: ${srcDate} ${srcPeriod}限 ↔ ${dstDate} ${dstPeriod}限`);

    setDragState(null);
    setDragOver(null);
  };

  const handleDragEnd = () => {
    setDragState(null);
    setDragOver(null);
  };

  // ─── Empty State ─────────────────────────────────────────────
  if (!isLoaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-foreground/70">ZIPファイルを読み込んでください</p>
          <p className="text-sm text-muted-foreground mt-1">左のサイドバーから「ZIPを開く」または<br />ドラッグ＆ドロップで読み込めます</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Today banner */}
      <TodayBanner entries={effectiveEntries} today={today} />

      {/* Grid */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              {/* Period header */}
              <th className="w-14 text-center text-xs text-muted-foreground font-medium py-2 border-b border-border" />
              {weekDates.map(date => {
                const isToday = date === today;
                const hasData = entryByDate.has(date);
                return (
                  <th
                    key={date}
                    className={cn(
                      "text-center py-2 px-1 border-b font-medium text-sm",
                      isToday
                        ? "border-b-2 border-amber-400 bg-[var(--today-bg)] text-amber-800"
                        : "border-border text-foreground/70"
                    )}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={cn("text-xs", isToday ? "text-amber-600 font-bold" : "text-muted-foreground")}>
                        {formatDateJP(date)}
                      </span>
                      {isToday && (
                        <span className="text-[9px] bg-amber-400 text-amber-900 rounded-full px-1.5 py-0.5 font-bold leading-none">
                          TODAY
                        </span>
                      )}
                      {!hasData && (
                        <span className="text-[9px] text-muted-foreground/50">データなし</span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6].map(period => (
              <tr key={period} className="group">
                {/* Period label */}
                <td className="text-center text-xs text-muted-foreground font-medium py-1 pr-2 border-b border-border/50 w-14">
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-foreground/60">{period}</span>
                    <span className="text-[9px] text-muted-foreground/50">限</span>
                  </div>
                </td>
                {weekDates.map(date => {
                  const slot = getSlot(date, period);
                  const isToday = date === today;
                  const isSelected = selectedCell?.date === date && selectedCell?.period === period;
                  const isDragSrc = dragState?.srcDate === date && dragState?.srcPeriod === period;
                  const isDragOver = dragOver?.date === date && dragOver?.period === period;
                  const colors = getClassColor(slot.class);

                  return (
                    <td
                      key={date}
                      className={cn(
                        "border-b border-r border-border/30 p-0.5",
                        isToday && "bg-[var(--today-bg)]/30"
                      )}
                    >
                      <div
                        draggable
                        onClick={() => setSelectedCell(isSelected ? null : { date, period })}
                        onDragStart={() => handleDragStart(date, period, slot.class)}
                        onDragOver={e => handleDragOver(e, date, period)}
                        onDrop={e => handleDrop(e, date, period)}
                        onDragEnd={handleDragEnd}
                        className={cn(
                          "period-cell h-[52px] rounded border cursor-pointer px-2 py-1 flex flex-col justify-between",
                          isSelected && "ring-2 ring-primary ring-inset",
                          isDragSrc && "opacity-40",
                          isDragOver && "ring-2 ring-green-500 ring-inset",
                          !slot.class && "hover:bg-muted/50",
                          slot.class && "hover:brightness-95"
                        )}
                        style={isDragOver
                          ? { backgroundColor: '#f0fdf4', borderColor: '#22c55e', ...colors.style }
                          : colors.style
                        }
                      >
                        {slot.class ? (
                          <>
                            <span className="text-xs font-bold leading-tight" style={colors.textStyle}>
                              {slot.class}
                            </span>
                            {slot.reason && (
                              <span className="text-[9px] bg-white/60 rounded px-1 text-muted-foreground truncate">
                                {slot.reason}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/30 self-center">
                            {slot.reason ? (
                              <span className="text-[9px] text-muted-foreground/50">{slot.reason}</span>
                            ) : "—"}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="font-medium">凡例:</span>
        {[
          { label: "4年", bg: "bg-blue-100", border: "border-blue-300" },
          { label: "5年", bg: "bg-emerald-100", border: "border-emerald-300" },
          { label: "6年", bg: "bg-violet-100", border: "border-violet-300" },
          { label: "空き", bg: "bg-muted", border: "border-border" },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1">
            <div className={cn("w-3 h-3 rounded border", item.bg, item.border)} />
            <span>{item.label}</span>
          </div>
        ))}
        <span className="ml-2 text-muted-foreground/60">ドラッグ＆ドロップで交換</span>
      </div>
    </div>
  );
}

// ─── Today Banner ─────────────────────────────────────────────

function TodayBanner({ entries, today }: { entries: TimetableEntry[]; today: string }) {
  const todayEntry = entries.find(e => e.date === today);
  if (!todayEntry) return null;

  const classes = todayEntry.periods.filter(p => p.class).map(p => ({
    period: p.period,
    class: p.class!,
    reason: p.reason,
  }));

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        <span className="text-xs font-bold text-amber-700">本日の授業予定 — {formatDateJP(today)}</span>
      </div>
      {classes.length === 0 ? (
        <p className="text-xs text-amber-600/70">本日の授業はありません</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {classes.map(c => (
            <div
              key={c.period}
              className="flex items-center gap-1.5 bg-white border border-amber-200 rounded-md px-2 py-1"
            >
              <span className="text-[10px] text-amber-600 font-bold">{c.period}限</span>
              <span className="text-xs font-medium text-foreground">{c.class}</span>
              {c.reason && (
                <span className="text-[9px] text-muted-foreground bg-muted rounded px-1">{c.reason}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
