// WeekGrid.tsx
// Design: Swiss Grid × Japanese Functional Design
// Week grid with drag-and-drop, today highlight, class color coding (1-6 grades)
// Phase 3: 教科表示対応（single_subject/homeroom/multi_subjectモード）

import { useState } from "react";
import { HolidaySettingsDialog } from "@/components/HolidaySettingsDialog";
import { useTimetable } from "@/contexts/TimetableContext";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { buildSwapOps, formatDate, formatDateJP, getWeekDates, PeriodSlot, TimetableEntry, todayISO } from "@/lib/timetable";
import { getClassColor, getSubjectColor } from "@/lib/gradeColors";
import { cn } from "@/lib/utils";
import { Filter, X, CalendarPlus, BookOpen, Users } from "lucide-react";
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
  srcSubject?: string | null;
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
    classList,
    holidays,
    mode,
    subjects,
  } = useTimetable();

  // classListが空の場合はフォールバック
  const effectiveClassList = classList.length > 0 ? classList : [];
  const { gradeColors, subjectColors } = useGradeColors();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOver, setDragOver] = useState<{ date: string; period: number } | null>(null);
  const [filterClass, setFilterClass] = useState<string | null>(null);
  const [filterSubject, setFilterSubject] = useState<string | null>(null);
  const [showHolidayDialog, setShowHolidayDialog] = useState(false);
  const today = todayISO();

  // homeroomモードでは担任クラスを固定
  const homeroomClass = semester?.homeroomClass ?? null;
  const isHomeroomMode = mode === 'homeroom';
  const isMultiSubjectMode = mode === 'multi_subject';
  const showSubject = isHomeroomMode || isMultiSubjectMode || (mode === 'single_subject' && subjects.length > 0);

  // クラス/教科メイン切替（デフォルト: homeroomモードは教科メイン、それ以外はクラスメイン）
  const [subjectFirst, setSubjectFirst] = useState<boolean>(isHomeroomMode);

  // holidays: HolidayEntry[] → 日付のSetとname mapに変換
  const holidayDates = new Set(holidays.map(h => h.date));
  const holidayNameMap = new Map(holidays.map(h => [h.date, h.name ?? '休校日']));

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
  const handleDragStart = (date: string, period: number, cls: string | null, subj?: string | null) => {
    setDragState({ srcDate: date, srcPeriod: period, srcClass: cls, srcSubject: subj });
  };

  const handleDragOver = (e: React.DragEvent, date: string, period: number) => {
    e.preventDefault();
    setDragOver({ date, period });
  };

  const handleDrop = (e: React.DragEvent, dstDate: string, dstPeriod: number) => {
    e.preventDefault();
    if (!dragState) return;
    const { srcDate, srcPeriod, srcClass, srcSubject } = dragState;
    if (srcDate === dstDate && srcPeriod === dstPeriod) {
      setDragState(null);
      setDragOver(null);
      return;
    }
    const dstSlot = getSlot(dstDate, dstPeriod);
    const dstClass = dstSlot.class;
    const dstSubject = dstSlot.subject;
    const ops = buildSwapOps(srcDate, srcPeriod, srcClass, dstDate, dstPeriod, dstClass, undefined, srcSubject, dstSubject);
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

  // Subject legend (for homeroom/multi_subject modes)
  const subjectsInData = new Set<string>();
  if (showSubject) {
    effectiveEntries.forEach(e => e.periods.forEach(p => {
      if (p.subject) subjectsInData.add(p.subject);
    }));
  }

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
            {isHomeroomMode && homeroomClass && (
              <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                担任: {homeroomClass}
              </span>
            )}
            {semester.customClasses && semester.customClasses.length > 0 && (
              <span className="text-xs text-muted-foreground/60">カスタム: {semester.customClasses.join(", ")}</span>
            )}
          </div>
        );
      })()}

      {/* Today banner */}
      <TodayBanner
        entries={effectiveEntries}
        today={today}
        gradeColors={gradeColors}
        subjectColors={subjectColors}
        showSubject={showSubject}
        isHomeroomMode={isHomeroomMode}
      />

      {/* Filter bar */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {/* Class filter (not shown in homeroom mode) */}
        {!isHomeroomMode && (
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
              {effectiveClassList.map(cls => (
                <DropdownMenuItem
                  key={cls}
                  onClick={() => setFilterClass(cls)}
                  className="text-xs"
                >
                  {cls}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {filterClass && (
          <button
            onClick={() => setFilterClass(null)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={11} />
            フィルター解除
          </button>
        )}

        {/* Subject/Class main toggle button */}
        {showSubject && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-7 gap-1.5 text-xs",
                  subjectFirst
                    ? "bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100"
                    : "bg-sky-50 border-sky-300 text-sky-700 hover:bg-sky-100"
                )}
                onClick={() => setSubjectFirst(v => !v)}
              >
                {subjectFirst ? <BookOpen size={11} /> : <Users size={11} />}
                {subjectFirst ? "教科メイン" : "クラスメイン"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {subjectFirst ? "教科を大きく、クラスを小さく表示中。クリックで切り替え" : "クラスを大きく、教科を小さく表示中。クリックで切り替え"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Subject filter (shown when subjects are available) */}
        {showSubject && subjects.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <Filter size={12} />
                {filterSubject ? filterSubject : "教科で絞り込み"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44 max-h-72 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">教科フィルター</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFilterSubject(null)} className="text-xs">
                すべて表示
              </DropdownMenuItem>
              {subjects.map(s => (
                <DropdownMenuItem
                  key={s.name}
                  onClick={() => setFilterSubject(s.name)}
                  className="text-xs"
                >
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {filterSubject && (
          <button
            onClick={() => setFilterSubject(null)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={11} />
            教科フィルター解除
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
                      holidayDates.has(date) && "bg-muted/60 text-muted-foreground"
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
                      {holidayDates.has(date) && (
                        <span className="text-[9px] bg-red-100 text-red-500 rounded-full px-1.5 py-0.5 font-medium leading-none">{holidayNameMap.get(date) ?? '休校'}</span>
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
                  const isFilteredByClass = filterClass !== null && slot.class !== filterClass;
                  const isFilteredBySubject = filterSubject !== null && slot.subject !== filterSubject;
                  const isFiltered = isFilteredByClass || isFilteredBySubject;

                  // Color logic: homeroom → subject color, single_subject/multi_subject → class (grade) color
                  const cellColors = (() => {
                    if (isHomeroomMode) {
                      if (slot.subject) return getSubjectColor(slot.subject, subjectColors);
                      if (slot.class) return getClassColor(slot.class, gradeColors);
                    }
                    // single_subject / multi_subject: always use grade color for clear class distinction
                    if (slot.class) return getClassColor(slot.class, gradeColors);
                    return null;
                  })();

                  return (
                    <td
                      key={date}
                      className={cn(
                        "border-b border-r border-border/30 p-0.5",
                        isToday && "bg-amber-50/60"
                      )}
                    >
                      <div
                        draggable
                        onClick={() => setSelectedCell(isSelected ? null : { date, period })}
                        onDragStart={() => handleDragStart(date, period, slot.class, slot.subject)}
                        onDragOver={e => handleDragOver(e, date, period)}
                        onDrop={e => handleDrop(e, date, period)}
                        onDragEnd={handleDragEnd}
                        className={cn(
                          "period-cell rounded border cursor-pointer px-2 py-1 flex flex-col justify-between",
                          showSubject ? "h-[60px]" : "h-[52px]",
                          isSelected && "ring-2 ring-primary ring-inset",
                          isDragSrc && "opacity-40",
                          isDragOver && "ring-2 ring-green-500 ring-inset",
                          !cellColors && "hover:bg-muted/50",
                          cellColors && "hover:brightness-95",
                          isFiltered && "opacity-20",
                          holidayDates.has(date) && "opacity-40 cursor-not-allowed"
                        )}
                        style={isDragOver
                          ? { backgroundColor: '#f0fdf4', borderColor: '#22c55e' }
                          : cellColors
                            ? { backgroundColor: cellColors.bg, borderColor: cellColors.border }
                            : undefined
                        }
                      >
                        {/* Cell content */}
                        {(() => {
                          const hasClass = !!slot.class;
                          const hasSubject = !!slot.subject;
                          const hasReason = !!slot.reason;

                          if (!hasClass && !hasSubject) {
                            // 空きコマ
                            return (
                              <span className="text-[10px] text-muted-foreground/30 self-center">
                                {hasReason ? <span className="text-[9px] text-muted-foreground/50">{slot.reason}</span> : "—"}
                              </span>
                            );
                          }

                          if (!showSubject) {
                            // 教科なしモード: クラスのみ
                            return (
                              <>
                                <span className="text-xs font-bold leading-tight" style={{ color: cellColors?.text }}>
                                  {slot.class}
                                </span>
                                {hasReason && (
                                  <span className="text-[9px] bg-white/60 rounded px-1 text-muted-foreground truncate">
                                    {slot.reason}
                                  </span>
                                )}
                              </>
                            );
                          }

                          // 教科ありモード: subjectFirstに応じてメイン/サブを切り替え
                          // mainLabelがnullの場合はフォールバックとして相手方を表示
                          const mainLabelRaw = subjectFirst
                            ? (hasSubject ? slot.subject : null)
                            : (hasClass ? slot.class : null);
                          const subLabelRaw = subjectFirst
                            ? (hasClass ? slot.class : null)
                            : (hasSubject ? slot.subject : null);
                          // mainLabelがnullならsubLabelをメインに昇格
                          const mainLabel = mainLabelRaw ?? subLabelRaw;
                          const subLabel = mainLabelRaw ? subLabelRaw : null;

                          return (
                            <>
                              <span className="text-xs font-bold leading-tight" style={{ color: cellColors?.text }}>
                                {mainLabel}
                              </span>
                              {subLabel && (
                                <span className="text-[9px] leading-tight" style={{ color: cellColors?.text, opacity: 0.65 }}>
                                  {subLabel}
                                </span>
                              )}
                              {hasReason && (
                                <span className="text-[9px] bg-white/60 rounded px-1 text-muted-foreground truncate">
                                  {slot.reason}
                                </span>
                              )}
                            </>
                          );
                        })()}
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
        {/* Class-based legend (not shown in homeroom mode) */}
        {!isHomeroomMode && legendGrades.map(grade => {
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
        {/* Subject-based legend (homeroom mode only) */}
        {isHomeroomMode && Array.from(subjectsInData).sort().map(subj => {
          const c = getSubjectColor(subj, subjectColors);
          return (
            <div key={subj} className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded border"
                style={{ backgroundColor: c.bg, borderColor: c.border }}
              />
              <span style={{ color: c.text }}>{subj}</span>
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
  entries, today, gradeColors, subjectColors, showSubject, isHomeroomMode
}: {
  entries: TimetableEntry[];
  today: string;
  gradeColors: Record<string, import("@/lib/gradeColors").GradeColorDef>;
  subjectColors: Record<string, import("@/lib/gradeColors").GradeColorDef>;
  showSubject: boolean;
  isHomeroomMode: boolean;
}) {
  const todayEntry = entries.find(e => e.date === today);
  if (!todayEntry) return null;

  const classes = todayEntry.periods.filter(p => p.class || p.subject).map(p => ({
    period: p.period,
    class: p.class,
    subject: p.subject,
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
            const color = isHomeroomMode && c.subject
              ? getSubjectColor(c.subject, subjectColors)
              : getClassColor(c.class, gradeColors);
            const displayLabel = isHomeroomMode
              ? (c.subject ?? c.class ?? "")
              : showSubject && c.subject
                ? `${c.class} / ${c.subject}`
                : (c.class ?? "");
            return (
              <div
                key={c.period}
                className="flex items-center gap-1.5 border rounded-md px-2 py-1"
                style={{ backgroundColor: color.bg, borderColor: color.border }}
              >
                <span className="text-[10px] text-amber-600 font-bold">{c.period}限</span>
                <span className="text-xs font-medium" style={{ color: color.text }}>{displayLabel}</span>
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
