// WeekGrid.tsx
// Design: Swiss Grid × Japanese Functional Design
// Week grid with drag-and-drop, today highlight, class color coding (1-6 grades)
// Phase 3: 教科表示対応（single_subject/homeroom/multi_subjectモード）

import { useState, useRef, useEffect, useCallback } from "react";
import { HolidaySettingsDialog } from "@/components/HolidaySettingsDialog";
import { PeriodTimesDialog } from "@/components/PeriodTimesDialog";
import { LLMImportDialog } from "@/components/LLMImportDialog";
import { useTimetable } from "@/contexts/TimetableContext";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { buildSwapOps, formatDate, formatDateJP, getWeekDates, PeriodSlot, TimetableEntry, todayISO } from "@/lib/timetable";
import { getClassColor, getSubjectColor } from "@/lib/gradeColors";
import { cn } from "@/lib/utils";
import { Filter, X, CalendarPlus, BookOpen, Users, ChevronLeft, ChevronRight, CalendarDays, Clock, Bot, FileJson, RotateCcw, CheckSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

// タッチ長押しドラッグの状態
interface TouchDragState {
  srcDate: string;
  srcPeriod: number;
  srcClass: string | null;
  srcSubject?: string | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  label: string; // ゴースト表示用
  labelSub?: string;
  bgColor?: string;
  textColor?: string;
}

export function WeekGrid() {
  const {
    effectiveEntries,
    currentWeekMonday,
    selectedCell, setSelectedCell,
    multiSelectMode, setMultiSelectMode, selectedCells, toggleSelectedCell, selectCellRange, clearSelectedCells,
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
    navigateWeek,
    goToToday,
    goToDate,
    updateWeekPatternOverride,
  } = useTimetable();
  // 最後にクリックしたセル（Shift範囲選択の起点）
  const lastClickedCellRef = useRef<{ date: string; period: number } | null>(null);

  // classListが空の場合はフォールバック
  const effectiveClassList = classList.length > 0 ? classList : [];
  const { gradeColors, subjectColors } = useGradeColors();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOver, setDragOver] = useState<{ date: string; period: number } | null>(null);

  // タッチ長押しドラッグ状態
  const [touchDrag, setTouchDrag] = useState<TouchDragState | null>(null);
  const [touchDragOver, setTouchDragOver] = useState<{ date: string; period: number } | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchDragRef = useRef<TouchDragState | null>(null); // ムーブハンドラー用
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map()); // date-period → DOMノード
  const [filterClass, setFilterClass] = useState<string | null>(null);
  const [filterSubject, setFilterSubject] = useState<string | null>(null);
  const [showHolidayDialog, setShowHolidayDialog] = useState(false);
  const [showPeriodTimesLocal, setShowPeriodTimesLocal] = useState(false);
  const [showLLMImportLocal, setShowLLMImportLocal] = useState(false);
  const [llmImportMode, setLlmImportMode] = useState<"timetable" | "period_times" | "schedule">("timetable");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerValue, setDatePickerValue] = useState("");
  const dateInputRef = useRef<HTMLInputElement>(null);
  const today = todayISO();

  // homeroomモードでは担任クラスを固定
  const homeroomClass = semester?.homeroomClass ?? null;
  const isHomeroomMode = mode === 'homeroom';
  const isMultiSubjectMode = mode === 'multi_subject';
  const isSingleSubjectMode = mode === 'single_subject';
  // 教科情報がある場合、またはsingle_subject/homeroomモードでは切り替えボタンを表示
  // （single_subjectやhomeroomはsubjects配列が空でも各コマに教科が記録される）
  const showSubject = subjects.length > 0 || isSingleSubjectMode || isHomeroomMode;

  // クラス/教科ビュー切替（デフォルト: homeroomモードは教科ビュー、それ以外はクラスビュー）
  const [subjectFirst, setSubjectFirst] = useState<boolean>(isHomeroomMode);

  // ファイル読み込み時にモードに応じた初期ビューを強制設定する
  // homeroom → 教科ビュー（subjectFirst=true）
  // single_subject / multi_subject → クラスビュー（subjectFirst=false）
  useEffect(() => {
    if (!isLoaded) return;
    setSubjectFirst(isHomeroomMode);
  }, [isLoaded, mode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ─── Touch Long-Press Drag Handlers ──────────────────────────
  // タッチ中に指の下にあるセルを特定する
  const getCellAtPoint = useCallback((x: number, y: number): { date: string; period: number } | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    // data-date / data-period属性を持つ親要素を湯る
    let node: Element | null = el;
    while (node) {
      const d = node.getAttribute("data-date");
      const p = node.getAttribute("data-period");
      if (d && p) return { date: d, period: Number(p) };
      node = node.parentElement;
    }
    return null;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, date: string, period: number, cls: string | null, subj: string | null | undefined, label: string, labelSub?: string, bgColor?: string, textColor?: string) => {
    const touch = e.touches[0];
    const startX = touch.clientX;
    const startY = touch.clientY;

    // 長押しタイマー（500ms）
    touchTimerRef.current = setTimeout(() => {
      // バイブレーション（サポートされる場合）
      if (navigator.vibrate) navigator.vibrate(50);

      const state: TouchDragState = {
        srcDate: date,
        srcPeriod: period,
        srcClass: cls,
        srcSubject: subj,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        label,
        labelSub,
        bgColor,
        textColor,
      };
      touchDragRef.current = state;
      setTouchDrag(state);
      setTouchDragOver({ date, period });
    }, 500);
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchDragRef.current) return;
    e.preventDefault(); // ページスクロールを防ぐ
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    // ゴースト位置を更新
    touchDragRef.current = { ...touchDragRef.current, currentX: x, currentY: y };
    setTouchDrag(prev => prev ? { ...prev, currentX: x, currentY: y } : null);

    // ホバー中のセルを特定
    const cell = getCellAtPoint(x, y);
    setTouchDragOver(cell);
  }, [getCellAtPoint]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // 長押しタイマーをクリア
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }

    const drag = touchDragRef.current;
    if (!drag) return;

    // ドロップ先を特定
    const touch = e.changedTouches[0];
    const cell = getCellAtPoint(touch.clientX, touch.clientY);

    if (cell && !(cell.date === drag.srcDate && cell.period === drag.srcPeriod)) {
      const dstSlot = getSlot(cell.date, cell.period);
      const ops = buildSwapOps(
        drag.srcDate, drag.srcPeriod, drag.srcClass,
        cell.date, cell.period, dstSlot.class,
        undefined,
        drag.srcSubject, dstSlot.subject
      );
      applyOps(ops, `交換: ${drag.srcDate} ${drag.srcPeriod}限 ↔ ${cell.date} ${cell.period}限`);
    }

    touchDragRef.current = null;
    setTouchDrag(null);
    setTouchDragOver(null);
  }, [getCellAtPoint, getSlot, applyOps]);

  const handleTouchCancel = useCallback(() => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    touchDragRef.current = null;
    setTouchDrag(null);
    setTouchDragOver(null);
  }, []);

  // グローバルタッチイベントリスナー（passive: falseでスクロール防止）
  useEffect(() => {
    const onMove = (e: TouchEvent) => handleTouchMove(e);
    const onEnd = (e: TouchEvent) => handleTouchEnd(e);
    const onCancel = () => handleTouchCancel();
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onCancel);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [handleTouchMove, handleTouchEnd, handleTouchCancel]);

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
      {/* Week Navigation Header */}
      {semester && (() => {
        const mon = currentWeekMonday;
        const year = mon.getFullYear();
        const month = mon.getMonth() + 1;
        const academicYear = month >= 4 ? year : year - 1;
        const semLabel = semester.semesterSystem === "semester"
          ? (semester.semesterNumber === 1 ? "前期" : "後期")
          : `${semester.semesterNumber}学期`;
        // 週の範囲ラベル
        const weekEnd = new Date(currentWeekMonday);
        weekEnd.setDate(weekEnd.getDate() + (showSaturday ? 5 : showSunday ? 6 : 4));
        const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
        const weekRangeLabel = `${fmt(currentWeekMonday)}～${fmt(weekEnd)}`;
        const isCurrentWeek = formatDate(currentWeekMonday) === formatDate(new Date(today));

        // 複週バッジ: A週/B週を計算
        let weekPatternLabel: string | null = null;
        let weekPatternIdx: number | null = null;
        let weekPatternCount = 1;
        const mondayStr = formatDate(currentWeekMonday);
        if (semester.baseSchedules && semester.baseSchedules.length > 1) {
          const WEEK_LABELS_GRID = ["A週", "B週", "C週", "D週"];
          weekPatternCount = semester.baseSchedules.length;
          // 手動上書きがあればそちらを優先
          if (semester.weekPatternOverrides?.[mondayStr] !== undefined) {
            weekPatternIdx = semester.weekPatternOverrides[mondayStr];
          } else {
            const refDateStr = semester.weekCycleStart ?? semester.startDate;
            const refDate = new Date(refDateStr + "T00:00:00");
            const refDow = refDate.getDay();
            const refDiff = refDow === 0 ? -6 : 1 - refDow;
            const cycleBaseMonday = new Date(refDate);
            cycleBaseMonday.setDate(cycleBaseMonday.getDate() + refDiff);
            cycleBaseMonday.setHours(0, 0, 0, 0);
            const msPerWeek = 7 * 24 * 60 * 60 * 1000;
            const weeksDiff = Math.round((currentWeekMonday.getTime() - cycleBaseMonday.getTime()) / msPerWeek);
            const n = semester.baseSchedules.length;
            weekPatternIdx = ((weeksDiff % n) + n) % n;
          }
          weekPatternLabel = WEEK_LABELS_GRID[weekPatternIdx] ?? null;
        }

        return (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {/* Meta badges */}
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-foreground">{academicYear}年度</span>
              <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">{semLabel}</span>
              {weekPatternLabel && weekPatternIdx !== null && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "text-xs rounded-full px-2 py-0.5 font-bold transition-colors",
                        semester.weekPatternOverrides?.[mondayStr] !== undefined
                          ? "bg-orange-100 text-orange-700 ring-1 ring-orange-400"
                          : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                      )}
                      title="タップして週パターンを変更"
                    >
                      {weekPatternLabel}
                      {semester.weekPatternOverrides?.[mondayStr] !== undefined && " ✎"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-3" align="start">
                    <p className="text-xs font-semibold text-foreground mb-2">この週のパターンを変更</p>
                    <div className="flex flex-col gap-1">
                      {Array.from({ length: weekPatternCount }, (_, i) => {
                        const labels = ["A週", "B週", "C週", "D週"];
                        return (
                          <button
                            key={i}
                            onClick={() => updateWeekPatternOverride(mondayStr, i)}
                            className={cn(
                              "text-left text-sm px-3 py-1.5 rounded-md transition-colors",
                              weekPatternIdx === i
                                ? "bg-blue-600 text-white font-semibold"
                                : "hover:bg-accent text-foreground"
                            )}
                          >
                            {labels[i]}
                          </button>
                        );
                      })}
                    </div>
                    {semester.weekPatternOverrides?.[mondayStr] !== undefined && (
                      <button
                        onClick={() => updateWeekPatternOverride(mondayStr, null)}
                        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        自動計算に戻す
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
              )}
              {isHomeroomMode && homeroomClass && (
                <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                  担任: {homeroomClass}
                </span>
              )}
            </div>
            {/* Week range label + date jump — pushed to right */}
            <div className="flex items-center gap-1 ml-auto">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={goToToday}
                    className={cn(
                      "h-8 px-3 text-xs font-medium rounded-md border transition-colors min-w-[8rem] text-center",
                      isCurrentWeek
                        ? "border-amber-400 bg-amber-50 text-amber-800 font-semibold"
                        : "border-border bg-background text-foreground/80 hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {isCurrentWeek && <span className="mr-1 text-amber-500">●</span>}
                    {weekRangeLabel}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">今週に戻る</TooltipContent>
              </Tooltip>
              {/* Date jump */}
              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setShowDatePicker(v => !v);
                        setTimeout(() => dateInputRef.current?.focus(), 50);
                      }}
                    >
                      <CalendarDays size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">日付で移動</TooltipContent>
                </Tooltip>
                {showDatePicker && (
                  <div className="absolute top-full mt-1 right-0 bg-popover border border-border rounded-lg shadow-lg p-2 z-50 w-48">
                    <p className="text-[10px] text-muted-foreground mb-1.5">移動先の日付を選択</p>
                    <input
                      ref={dateInputRef}
                      type="date"
                      value={datePickerValue}
                      min={semester.startDate}
                      max={semester.endDate}
                      onChange={e => {
                        setDatePickerValue(e.target.value);
                        if (e.target.value) {
                          goToDate(new Date(e.target.value + "T00:00:00"));
                          setShowDatePicker(false);
                          setDatePickerValue("");
                        }
                      }}
                      onBlur={() => setTimeout(() => setShowDatePicker(false), 150)}
                      className="w-full text-[11px] bg-background border border-border rounded px-2 py-1 text-foreground"
                    />
                  </div>
                )}
              </div>
            </div>
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

      {/* Filter bar: ビュー切替 → クラス絞り込み → 教科絞り込み */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {/* 複数選択ボタン */}
        {isLoaded && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-7 gap-1.5 text-xs",
                  multiSelectMode
                    ? "bg-amber-100 border-amber-400 text-amber-700 hover:bg-amber-200"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
                onClick={() => {
                  if (multiSelectMode) {
                    setMultiSelectMode(false);
                  } else {
                    setSelectedCell(null);
                    setMultiSelectMode(true);
                  }
                }}
              >
                <CheckSquare size={11} />
                {multiSelectMode ? `複数選択中 (${selectedCells.size})` : "複数選択"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {multiSelectMode ? "複数選択モードを解除" : "複数のコマを同時編集するモードに入る"}
            </TooltipContent>
          </Tooltip>
        )}
        {/* Subject/Class main toggle button: 教科情報がある場合は常に表示（一番左） */}
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
                {subjectFirst ? "教科ビュー" : "クラスビュー"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {subjectFirst ? "教科を大きく、クラスを小さく表示中。クリックで切り替え" : "クラスを大きく、教科を小さく表示中。クリックで切り替え"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Class filter (not shown in homeroom mode) */}
        {!isHomeroomMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-7 gap-1.5 text-xs", filterClass && "border-primary text-primary")}>
                <Filter size={12} />
                {filterClass ? filterClass : "クラスで絞り込み"}
                {filterClass && (
                  <span
                    role="button"
                    onClick={e => { e.stopPropagation(); setFilterClass(null); }}
                    className="ml-1 hover:text-destructive"
                  >
                    <X size={10} />
                  </span>
                )}
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

        {/* Subject filter (shown when subjects are available) */}
        {showSubject && subjects.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-7 gap-1.5 text-xs", filterSubject && "border-primary text-primary")}>
                <Filter size={12} />
                {filterSubject ? filterSubject : "教科で絞り込み"}
                {filterSubject && (
                  <span
                    role="button"
                    onClick={e => { e.stopPropagation(); setFilterSubject(null); }}
                    className="ml-1 hover:text-destructive"
                  >
                    <X size={10} />
                  </span>
                )}
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

        {/* Period times + Weekend temporary class buttons */}
        {isLoaded && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 gap-1 text-xs",
                    semester?.periodTimes && Object.keys(semester.periodTimes).length > 0
                      ? "border-blue-400 text-blue-600 dark:text-blue-400"
                      : ""
                  )}
                  onClick={() => setShowPeriodTimesLocal(true)}
                >
                  <Clock size={11} />
                  時程表
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {semester?.periodTimes && Object.keys(semester.periodTimes).length > 0
                  ? "時程表設定済（クリックで編集）"
                  : "各コマの開始・終了時刻を設定（ICS書き出し用）"
                }
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs text-purple-600 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-950/30"
                >
                  <Bot size={11} />
                  LLM読み取り
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">画像から読み取る</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-xs gap-2" onClick={() => { setLlmImportMode("timetable"); setShowLLMImportLocal(true); }}>
                  <FileJson size={12} className="text-blue-500" />時間割
                </DropdownMenuItem>
                <DropdownMenuItem className="text-xs gap-2" onClick={() => { setLlmImportMode("period_times"); setShowLLMImportLocal(true); }}>
                  <Clock size={12} className="text-green-500" />時程表
                </DropdownMenuItem>
                <DropdownMenuItem className="text-xs gap-2" onClick={() => { setLlmImportMode("schedule"); setShowLLMImportLocal(true); }}>
                  <CalendarDays size={12} className="text-amber-500" />年間予定表
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
      {/* 複数選択モードバー */}
      {isLoaded && multiSelectMode && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300">
          <CheckSquare size={14} className="text-amber-600 shrink-0" />
          <span className="text-xs font-semibold text-amber-700">複数選択モード</span>
          <span className="text-xs text-amber-600">— セルをタップで選択、Shift+クリックで範囲選択、Cmd/Ctrl+クリックで追加選択</span>
          {selectedCells.size > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 text-[11px] font-bold">{selectedCells.size}コマ選択中</span>
          )}
          <button
            onClick={() => setMultiSelectMode(false)}
            className="ml-auto text-xs text-amber-600 hover:text-amber-800 underline"
          >解除</button>
        </div>
      )}

      {/* Grid */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              {/* 前の週ボタン — 左端 */}
              <th className="w-14 border-b border-border p-0">
                <button
                  onClick={() => navigateWeek(-1)}
                  className="w-full h-full flex flex-col items-center justify-center gap-0.5 py-2 hover:bg-accent rounded transition-colors group"
                  title="前の週"
                >
                  <ChevronLeft size={14} className="text-muted-foreground group-hover:text-foreground" />
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground leading-none">前の週</span>
                </button>
              </th>
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
              {/* 次の週ボタン — 右端 */}
              <th className="w-14 border-b border-border p-0">
                <button
                  onClick={() => navigateWeek(1)}
                  className="w-full h-full flex flex-col items-center justify-center gap-0.5 py-2 hover:bg-accent rounded transition-colors group"
                  title="次の週"
                >
                  <ChevronRight size={14} className="text-muted-foreground group-hover:text-foreground" />
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground leading-none">次の週</span>
                </button>
              </th>
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
                  const cellKey = `${date}|${period}`;
                  const isMultiSelected = selectedCells.has(cellKey);
                  const isDragSrc = dragState?.srcDate === date && dragState?.srcPeriod === period;
                  const isDragOver = dragOver?.date === date && dragOver?.period === period;

                  // Filter: dim non-matching cells
                  const isFilteredByClass = filterClass !== null && slot.class !== filterClass;
                  const isFilteredBySubject = filterSubject !== null && slot.subject !== filterSubject;
                  const isFiltered = isFilteredByClass || isFilteredBySubject;

                  // Color logic: subjectFirstに応じて教科色または学年色を適用
                   // 教科ビュー時: 教科色を優先、教科なしの場合は学年色へフォールバック
                   // クラスビュー時: 学年色を優先、クラスなしの場合は教科色へフォールバック
                  const cellColors = (() => {
                    if (showSubject && subjectFirst) {
                      if (slot.subject) return getSubjectColor(slot.subject, subjectColors);
                      if (slot.class) return getClassColor(slot.class, gradeColors);
                    } else {
                      if (slot.class) return getClassColor(slot.class, gradeColors);
                      if (slot.subject) return getSubjectColor(slot.subject, subjectColors);
                    }
                    return null;
                  })();

                  // タッチドラッグ用のラベル計算
                  const touchLabel = (() => {
                    if (showSubject && subjectFirst) return slot.subject ?? slot.class ?? "空き";
                    return slot.class ?? slot.subject ?? "空き";
                  })();
                  const touchLabelSub = (() => {
                    if (showSubject && subjectFirst) return slot.class ?? undefined;
                    return slot.subject ?? undefined;
                  })();

                  const isTouchDragSrc = touchDrag?.srcDate === date && touchDrag?.srcPeriod === period;
                  const isTouchDragOver = touchDragOver?.date === date && touchDragOver?.period === period;

                  return (
                    <td
                      key={date}
                      className={cn(
                        "border-b border-r border-border/30 p-0.5",
                        isToday && "bg-amber-50/60"
                      )}
                    >
                      <div
                        data-date={date}
                        data-period={String(period)}
                        draggable={!multiSelectMode}
                        onClick={(e) => {
                          if (multiSelectMode) {
                            if (e.shiftKey && lastClickedCellRef.current) {
                              // Shift: 範囲選択
                              selectCellRange(
                                lastClickedCellRef.current.date, lastClickedCellRef.current.period,
                                date, period,
                                weekDates, [1,2,3,4,5,6]
                              );
                            } else if (e.metaKey || e.ctrlKey) {
                              // Cmd/Ctrl: 個別追加トグル
                              toggleSelectedCell(date, period);
                              lastClickedCellRef.current = { date, period };
                            } else {
                              // 通常タップ: トグル
                              toggleSelectedCell(date, period);
                              lastClickedCellRef.current = { date, period };
                            }
                          } else {
                            setSelectedCell(isSelected ? null : { date, period });
                          }
                        }}
                        onDragStart={() => handleDragStart(date, period, slot.class, slot.subject)}
                        onDragOver={e => handleDragOver(e, date, period)}
                        onDrop={e => handleDrop(e, date, period)}
                        onDragEnd={handleDragEnd}
                        onTouchStart={e => handleTouchStart(
                          e, date, period, slot.class, slot.subject,
                          touchLabel, touchLabelSub,
                          cellColors?.bg, cellColors?.text
                        )}
                        className={cn(
                          "period-cell rounded border cursor-pointer px-2 py-1 flex flex-col justify-between select-none",
                          showSubject ? "h-[60px]" : "h-[52px]",
                          isSelected && !multiSelectMode && "ring-2 ring-primary ring-inset",
                          isMultiSelected && "ring-2 ring-amber-500 ring-inset bg-amber-50/80",
                          (isDragSrc || isTouchDragSrc) && "opacity-40 scale-95",
                          isDragOver && "ring-2 ring-green-500 ring-inset",
                          isTouchDragOver && !isTouchDragSrc && "ring-2 ring-blue-500 ring-inset",
                          !cellColors && "hover:bg-muted/50",
                          cellColors && "hover:brightness-95",
                          isFiltered && "opacity-20",
                          holidayDates.has(date) && "opacity-40 cursor-not-allowed"
                        )}
                        style={isDragOver
                          ? { backgroundColor: '#f0fdf4', borderColor: '#22c55e' }
                          : isTouchDragOver && !isTouchDragSrc
                            ? { backgroundColor: '#eff6ff', borderColor: '#3b82f6' }
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
                {/* 右端のスペーサーセル */}
                <td className="w-14 border-b border-border/30" />
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
        {/* Subject-based legend */}
        {showSubject && Array.from(subjectsInData).sort().map(subj => {
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
        <span className="ml-2 text-muted-foreground/60 hidden sm:inline">ドラッグ＆ドロップで交換</span>
        <span className="ml-2 text-muted-foreground/60 sm:hidden">長押しでドラッグ交換</span>
      </div>

      {/* タッチドラッグゴースト */}
      {touchDrag && (
        <div
          className="fixed z-[300] pointer-events-none"
          style={{
            left: touchDrag.currentX - 40,
            top: touchDrag.currentY - 40,
            transform: "scale(1.15)",
            transition: "transform 0.1s ease",
          }}
        >
          <div
            className="w-20 rounded-lg border-2 shadow-2xl px-2 py-2 flex flex-col items-center justify-center gap-0.5"
            style={{
              backgroundColor: touchDrag.bgColor ?? '#ffffff',
              borderColor: '#3b82f6',
              boxShadow: '0 8px 32px rgba(59,130,246,0.35), 0 2px 8px rgba(0,0,0,0.2)',
              minHeight: 52,
            }}
          >
            <span className="text-xs font-bold leading-tight text-center" style={{ color: touchDrag.textColor ?? '#1e293b' }}>
              {touchDrag.label}
            </span>
            {touchDrag.labelSub && (
              <span className="text-[10px] leading-tight text-center" style={{ color: touchDrag.textColor ?? '#64748b', opacity: 0.7 }}>
                {touchDrag.labelSub}
              </span>
            )}
          </div>
          {/* ドロップ先の表示 */}
          {touchDragOver && !(touchDragOver.date === touchDrag.srcDate && touchDragOver.period === touchDrag.srcPeriod) && (
            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
              <span className="text-[10px] bg-blue-600 text-white rounded-full px-2 py-0.5 font-medium">
                ↔ 交換
              </span>
            </div>
          )}
        </div>
      )}

      <HolidaySettingsDialog open={showHolidayDialog} onOpenChange={setShowHolidayDialog} />
      <PeriodTimesDialog open={showPeriodTimesLocal} onOpenChange={setShowPeriodTimesLocal} />
      <LLMImportDialog open={showLLMImportLocal} onOpenChange={setShowLLMImportLocal} mode={llmImportMode} />
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
