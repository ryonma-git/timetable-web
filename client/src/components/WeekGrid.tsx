// WeekGrid.tsx
// Design: Swiss Grid × Japanese Functional Design
// Week grid with drag-and-drop, today highlight, class color coding (1-6 grades)

import { useState } from "react";
import { HolidaySettingsDialog } from "@/components/HolidaySettingsDialog";
import { useTimetable } from "@/contexts/TimetableContext";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { buildSwapOps, formatDate, formatDateJP, getWeekDates, PeriodSlot, TimetableEntry, todayISO, VALID_CLASSES } from "@/lib/timetable";
import { getClassColor } from "@/lib/gradeColors";
import { cn } from "@/lib/utils";
import { Filter, X, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PERIOD_LABELS = ["", "1限", "2限", "3限", "4限", "5限", "6限"];

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
    semester,
    weekendOverrides,
    toggleWeekendDay,
    customClasses,
    holidays,
  } = useTimetable();
  const { gradeColors } = useGradeColors();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOver, setDragOver] = useState<{ date: string; period: number } | null>(null);
  const [filterClass, setFilterClass] = useState<string | null>(null);
  const [showHolidayDialog, setShowHolidayDialog] = useState(false);
  const today = todayISO();

  // Determine if this week shows Saturday/Sunday
  const weekMondayStr = formatDate(currentWeekMonday);
  const weekOverride = weekendOverrides[weekMondayStr] ?? {};
  const showSaturday = semester?.hasSaturday || weekOverride.saturday || false;
  const showSunday = semester?.hasSunday || weekOverride.sunday || false;

  const weekDates = getWeekDates(currentWeekMonday, {
    includeSaturday: showSaturday,
    includeSunday: showSunday,
  });

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
          <p className="text-base font-semibold text-foreground/70">データを読み込んでください</p>
          <p className="text-sm text-muted-foreground mt-1">
            左のサイドバーから「ファイルを開く」または<br />「新規作成」でデータを準備できます
          </p>
        </div>
      </div>
    );
  }

  // Grade keys for legend (only those appearing in data)
  const gradesInData = new Set<string>();
  effectiveEntries.forEach(e => e.periods.forEach(p => {
    if (p.class) {
      const m = p.class.match(/^(\d)年/);
      if (m) gradesInData.add(m[1]);
    }
  }));
  const legendGrades = Array.from(gradesInData).sort();

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Year/Academic year header */}
      {semester && (() => {
        const mon = currentWeekMonday;
        const year = mon.getFullYear();
        const month = mon.getMonth() + 1;
        const academicYear = month >= 4 ? year : year - 1;
        const semLabel = semester.semesterSystem === "semester"
          ? (semester.semesterNumber === 1 ? "前期" : "後期")
          : `${semester.semesterNumber}学期`;
        return (
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-base font-bold text-foreground">{academicYear}年度</span>
            <span className="text-sm text-muted-foreground">{year}年</span>
            <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">{semLabel}</span>
            {semester.customClasses && semester.customClasses.length > 0 && (
              <span className="text-xs text-muted-foreground/60">カスタム: {semester.customClasses.join(", ")}</span>
            )}
          </div>
        );
      })()}

      {/* Today banner */}
      <TodayBanner entries={effectiveEntries} today={today} gradeColors={gradeColors} />

      {/* Filter bar */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
              <Filter size={12} />
              {filterClass ? filterClass : "クラスで絞り込み"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44 max-h-72 overflow-y-auto">
            <DropdownMenuLabel className="text-xs">クラスフィルター</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setFilterClass(null)} className="text-xs">
              すべて表示
            </DropdownMenuItem>
            {["1年", "2年", "3年", "4年", "5年", "6年"].map(grade => {
              const gradeClasses = VALID_CLASSES.filter(c => c.startsWith(grade));
              if (gradeClasses.length === 0) return null;
              return gradeClasses.map(cls => (
                <DropdownMenuItem
                  key={cls}
                  onClick={() => setFilterClass(cls)}
                  className="text-xs"
                >
                  {cls}
                </DropdownMenuItem>
              ));
            })}
            {customClasses.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">カスタム</DropdownMenuLabel>
                {customClasses.map(cls => (
                  <DropdownMenuItem key={cls} onClick={() => setFilterClass(cls)} className="text-xs">{cls}</DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {filterClass && (
          <button
            onClick={() => setFilterClass(null)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={11} />
            フィルター解除
          </button>
        )}

        {/* Weekend temporary class buttons */}
        {isLoaded && (
          <div className="flex items-center gap-1.5 ml-auto">
            {!semester?.hasSaturday && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={weekOverride.saturday ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "h-7 gap-1 text-xs",
                      weekOverride.saturday && "bg-orange-500 hover:bg-orange-600 border-orange-500 text-white"
                    )}
                    onClick={() => toggleWeekendDay(weekMondayStr, 'saturday')}
                  >
                    <CalendarPlus size={11} />
                    土曜授業
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  この週のみ土曜日を授業日として表示
                </TooltipContent>
              </Tooltip>
            )}
            {!semester?.hasSunday && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={weekOverride.sunday ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "h-7 gap-1 text-xs",
                      weekOverride.sunday && "bg-purple-500 hover:bg-purple-600 border-purple-500 text-white"
                    )}
                    onClick={() => toggleWeekendDay(weekMondayStr, 'sunday')}
                  >
                    <CalendarPlus size={11} />
                    日曜授業
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  この週のみ日曜日を授業日として表示
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 600 }}>
          <thead>
            <tr>
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
                        : "border-border text-foreground/70",
                      holidays.includes(date) && "bg-muted/60 text-muted-foreground"
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
                      {holidays.includes(date) && (
                        <span className="text-[9px] bg-red-100 text-red-500 rounded-full px-1.5 py-0.5 font-medium leading-none">休校</span>
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

                  // Filter: dim non-matching cells
                  const isFiltered = filterClass !== null && slot.class !== filterClass;
                  const colors = getClassColor(slot.class, gradeColors);

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
                        slot.class && "hover:brightness-95",
                        isFiltered && "opacity-20",
                        holidays.includes(date) && "opacity-40 cursor-not-allowed"
                      )}
                        style={isDragOver
                          ? { backgroundColor: '#f0fdf4', borderColor: '#22c55e' }
                          : { backgroundColor: colors.bg, borderColor: colors.border }
                        }
                      >
                        {slot.class ? (
                          <>
                            <span className="text-xs font-bold leading-tight" style={{ color: colors.text }}>
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

      {/* Dynamic Legend */}
      <div className="mt-3 flex items-center flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="font-medium">凡例:</span>
        {legendGrades.map(grade => {
          const c = gradeColors[grade];
          if (!c) return null;
          return (
            <div key={grade} className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded border"
                style={{ backgroundColor: c.bg, borderColor: c.border }}
              />
              <span style={{ color: c.text }}>{grade}年</span>
            </div>
          );
        })}
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded border bg-muted border-border" />
          <span>空き</span>
        </div>
        <span className="ml-2 text-muted-foreground/60">ドラッグ＆ドロップで交換</span>
      </div>

      <HolidaySettingsDialog open={showHolidayDialog} onOpenChange={setShowHolidayDialog} />
    </div>
  );
}

// ─── Today Banner ─────────────────────────────────────────────

function TodayBanner({
  entries, today, gradeColors
}: {
  entries: TimetableEntry[];
  today: string;
  gradeColors: Record<string, import("@/lib/gradeColors").GradeColorDef>;
}) {
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
          {classes.map(c => {
            const color = getClassColor(c.class, gradeColors);
            return (
              <div
                key={c.period}
                className="flex items-center gap-1.5 border rounded-md px-2 py-1"
                style={{ backgroundColor: color.bg, borderColor: color.border }}
              >
                <span className="text-[10px] text-amber-600 font-bold">{c.period}限</span>
                <span className="text-xs font-medium" style={{ color: color.text }}>{c.class}</span>
                {c.reason && (
                  <span className="text-[9px] text-muted-foreground bg-white/60 rounded px-1">{c.reason}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
