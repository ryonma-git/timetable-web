// Settings dialog: edit semester meta, base schedule, class config after creation
// Phase 4: homeroomClass設定・モード選択を追加

import { useState, useCallback, useEffect } from "react";
import {
  Settings,
  ChevronRight,
  ChevronLeft,
  Check,
  School,
  Calendar,
  Grid3X3,
  Plus,
  Minus,
  X,
  AlertTriangle,
  BookOpen,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SemesterMeta, SemesterSystem, TimetableMode } from "@/lib/timetableFile";
import { useTimetable } from "@/contexts/TimetableContext";
import {
  normalizeClassName,
  classSort,
  generateDefaultClasses,
  SchoolType,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

const WEEKDAYS = [
  { key: "Mon", label: "月" },
  { key: "Tue", label: "火" },
  { key: "Wed", label: "水" },
  { key: "Thu", label: "木" },
  { key: "Fri", label: "金" },
];
const PERIODS = [1, 2, 3, 4, 5, 6];

const SCHOOL_TYPES: { value: SchoolType; label: string; grades: number; defaultClasses: number }[] = [
  { value: "elementary", label: "小学校（6年制）", grades: 6, defaultClasses: 3 },
  { value: "junior", label: "中学校（3年制）", grades: 3, defaultClasses: 3 },
  { value: "high", label: "高等学校（3年制）", grades: 3, defaultClasses: 3 },
];

function getDefaultAcademicYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 4 ? year : year - 1;
}

function getYearOptions(): number[] {
  const max = getDefaultAcademicYear() + 30;
  const years: number[] = [];
  for (let y = 2024; y <= max; y++) years.push(y);
  return years;
}

function getSemesterDefaults(year: number, semester: 1 | 2 | 3, system: SemesterSystem) {
  if (system === "semester") {
    switch (semester) {
      case 1: return { start: `${year}-04-01`, end: `${year}-09-30` };
      case 2: return { start: `${year}-10-01`, end: `${year + 1}-03-31` };
      default: return { start: `${year}-04-01`, end: `${year}-09-30` };
    }
  }
  switch (semester) {
    case 1: return { start: `${year}-04-01`, end: `${year}-07-20` };
    case 2: return { start: `${year}-09-01`, end: `${year}-12-25` };
    case 3: return { start: `${year + 1}-01-08`, end: `${year + 1}-03-25` };
  }
}

// Step indicator
function StepIndicator({ current, total }: { current: number; total: number }) {
  const steps = [
    { icon: <School size={13} />, label: "学校情報" },
    { icon: <Calendar size={13} />, label: "授業日設定" },
    { icon: <Grid3X3 size={13} />, label: "基本時間割" },
    { icon: <BookOpen size={13} />, label: "教科設定" },
    { icon: <Check size={13} />, label: "確認・適用" },
  ];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((step, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === current;
        const isDone = stepNum < current;
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all",
                isActive && "bg-primary text-primary-foreground border-primary",
                isDone && "bg-primary/20 text-primary border-primary/50",
                !isActive && !isDone && "bg-muted text-muted-foreground border-border"
              )}>
                {isDone ? <Check size={11} /> : step.icon}
              </div>
              <span className={cn(
                "text-[9px] font-medium whitespace-nowrap",
                isActive ? "text-primary" : "text-muted-foreground"
              )}>{step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn(
                "h-0.5 w-7 mx-1 mb-4 transition-all",
                stepNum < current ? "bg-primary/50" : "bg-border"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: Props) {
  const { currentFile, semester: semesterFromCtx, updateSettings, isLoaded, mode, setMode, classList, subjects, activeSemesterIndex } = useTimetable();
  // semesters配列形式の場合はアクティブ学期のデータを使用（単一学期の場合はレガシーフィールドを使用）
  const semester = currentFile?.semesters && currentFile.semesters.length > 0
    ? currentFile.semesters[activeSemesterIndex]?.semester ?? semesterFromCtx
    : semesterFromCtx;
  const [step, setStep] = useState(1);

  // ── Step 1: Basic info ──────────────────────────────────────
  const [school, setSchool] = useState("");
  const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
  const [semesterSystem, setSemesterSystem] = useState<SemesterSystem>("trimester");
  const [semesterNumber, setSemesterNumber] = useState<1 | 2 | 3>(1);

  // ── Step 1: Class config ────────────────────────────────────
  const [schoolType, setSchoolType] = useState<SchoolType>("elementary");
  const [gradeClassCounts, setGradeClassCounts] = useState<number[]>([3, 3, 3, 3, 3, 3]);
  const [extraClasses, setExtraClasses] = useState<string[]>([]);
  const [customClassInput, setCustomClassInput] = useState("");
  const [customClassError, setCustomClassError] = useState("");

  // ── Step 1: Mode & homeroom ─────────────────────────────────
  const [selectedMode, setSelectedMode] = useState<TimetableMode>('single_subject');
  const [homeroomClass, setHomeroomClass] = useState("");

  // ── Step 2: Date & weekend ──────────────────────────────────
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasSaturday, setHasSaturday] = useState(false);
  const [hasSunday, setHasSunday] = useState(false);
  // ── Step 3: Base schedule (複週対応) ────────────────────────────────────────
  const WEEK_LABELS_S = ["A週", "B週", "C週", "D週"];
  const [weekCount, setWeekCount] = useState<1 | 2 | 3 | 4>(1);
  const [activeWeekTab, setActiveWeekTab] = useState(0);
  const makeEmptyScheduleS = () => {
    const s: Record<string, Record<number, string | null>> = {};
    WEEKDAYS.forEach(d => { s[d.key] = {}; PERIODS.forEach(p => { s[d.key][p] = null; }); });
    return s;
  };
  const [baseSchedulesArr, setBaseSchedulesArr] = useState<Record<string, Record<number, string | null>>[]>(() => [makeEmptyScheduleS()]);
  const baseSchedule = baseSchedulesArr[activeWeekTab] ?? makeEmptyScheduleS();
  const setBaseSchedule = (updater: Record<string, Record<number, string | null>> | ((prev: Record<string, Record<number, string | null>>) => Record<string, Record<number, string | null>>)) => {
    setBaseSchedulesArr(prev => {
      const next = [...prev];
      next[activeWeekTab] = typeof updater === 'function' ? updater(next[activeWeekTab] ?? makeEmptyScheduleS()) : updater;
      return next;
    });
  };
  const [weekCycleStartInput, setWeekCycleStartInput] = useState(""); // 手動入力用基準日
  // 教科設定: 週ごとの教科スケジュール配列
  const [subjectScheduleArr, setSubjectScheduleArr] = useState<Record<string, Record<number, string | null>>[]>(() => [makeEmptyScheduleS()]);
  const [activeSubjectTab, setActiveSubjectTab] = useState(0);
  const currentSubjectSchedule = subjectScheduleArr[activeSubjectTab] ?? makeEmptyScheduleS();
  const setCurrentSubjectSchedule = (updater: Record<string, Record<number, string | null>> | ((prev: Record<string, Record<number, string | null>>) => Record<string, Record<number, string | null>>)) => {
    setSubjectScheduleArr(prev => {
      const next = [...prev];
      next[activeSubjectTab] = typeof updater === 'function' ? updater(next[activeSubjectTab] ?? makeEmptyScheduleS()) : updater;
      return next;
    });
  };
  const handleWeekCountChangeS = (n: 1 | 2 | 3 | 4) => {
    setWeekCount(n);
    setActiveWeekTab(prev => Math.min(prev, n - 1));
    setBaseSchedulesArr(prev => {
      const next = [...prev];
      while (next.length < n) next.push(makeEmptyScheduleS());
      return next.slice(0, n);
    });
    setSubjectScheduleArr(prev => {
      const next = [...prev];
      while (next.length < n) next.push(makeEmptyScheduleS());
      return next.slice(0, n);
    });
  };
  // ── Step 4: Apply mode ──────────────────────────────────────────────
  const [applyMode, setApplyMode] = useState<"all" | "from">("all");
  const [applyFromDate, setApplyFromDate] = useState("");

  // Derived: current school type info
  const schoolTypeInfo = SCHOOL_TYPES.find(s => s.value === schoolType) ?? SCHOOL_TYPES[0];
  const grades = schoolTypeInfo.grades;

  // Generated class list
  const generatedClasses = generateDefaultClasses(schoolType, gradeClassCounts.slice(0, grades));
  const allClasses = [...generatedClasses, ...extraClasses].sort(classSort);

  // Effective class list for homeroom selection (use current classList if available)
  const effectiveClassList = classList.length > 0 ? classList : allClasses;

  // Populate from current semester on open
  useEffect(() => {
    if (open && semester) {
      setSchool(currentFile?.meta.school ?? "");
      setAcademicYear(() => {
        const y = currentFile?.meta.year;
        if (y) {
          const m = y.match(/(\d{4})/);
          if (m) return Number(m[1]);
        }
        return getDefaultAcademicYear();
      });
      setSemesterSystem(semester.semesterSystem ?? "trimester");
      setSemesterNumber(semester.semesterNumber);
      setStartDate(semester.startDate);
      setEndDate(semester.endDate);
      setHasSaturday(semester.hasSaturday);
      setHasSunday(semester.hasSunday);

      // Restore school type & class counts
      const st = (semester.schoolType as SchoolType) ?? "elementary";
      setSchoolType(st);
      const info = SCHOOL_TYPES.find(s => s.value === st) ?? SCHOOL_TYPES[0];
      if (semester.gradeClassCounts && semester.gradeClassCounts.length > 0) {
        const counts = [...semester.gradeClassCounts];
        while (counts.length < info.grades) counts.push(info.defaultClasses);
        setGradeClassCounts(counts);
      } else {
        setGradeClassCounts(Array(info.grades).fill(info.defaultClasses));
      }
      setExtraClasses(semester.customClasses ?? []);

      // Restore mode & homeroomClass
      setSelectedMode(currentFile?.meta.mode ?? 'single_subject');
      setHomeroomClass(semester.homeroomClass ?? "");

      // Populate base schedule (複週対応)
      if (semester.baseSchedules && semester.baseSchedules.length >= 1) {
        // 複週データを読み込む
        const wc = Math.min(4, semester.baseSchedules.length) as 1 | 2 | 3 | 4;
        setWeekCount(wc);
        setActiveWeekTab(0);
        setActiveSubjectTab(0);
        setBaseSchedulesArr(semester.baseSchedules.map(ws => {
          const s: Record<string, Record<number, string | null>> = {};
          WEEKDAYS.forEach(d => { s[d.key] = {}; PERIODS.forEach(p => { s[d.key][p] = ws.schedule[d.key]?.[p] ?? null; }); });
          return s;
        }));
        // 教科スケジュールを読み込む
        setSubjectScheduleArr(semester.baseSchedules.map(ws => {
          const s: Record<string, Record<number, string | null>> = {};
          WEEKDAYS.forEach(d => { s[d.key] = {}; PERIODS.forEach(p => { s[d.key][p] = ws.subjectSchedule?.[d.key]?.[p] ?? null; }); });
          return s;
        }));
        // weekCycleStartを読み込む
        setWeekCycleStartInput(semester.weekCycleStart ?? "");
      } else {
        // 単週データを読み込む
        setWeekCount(1);
        setActiveWeekTab(0);
        setActiveSubjectTab(0);
        const s: Record<string, Record<number, string | null>> = {};
        WEEKDAYS.forEach(d => {
          s[d.key] = {};
          PERIODS.forEach(p => { s[d.key][p] = semester.baseSchedule?.[d.key]?.[p] ?? null; });
        });
        setBaseSchedulesArr([s]);
        // 教科スケジュールも初期化（単週はトップレベルのsubjectScheduleを使用）
        const ss: Record<string, Record<number, string | null>> = {};
        WEEKDAYS.forEach(d => {
          ss[d.key] = {};
          PERIODS.forEach(p => { ss[d.key][p] = semester.subjectSchedule?.[d.key]?.[p] ?? null; });
        });
        setSubjectScheduleArr([ss]);
      }
      setStep(1);
      setApplyMode("all");
      setApplyFromDate(semester.startDate);
    }
  }, [open, semester, currentFile, activeSemesterIndex]);

  const handleSchoolTypeChange = (type: SchoolType) => {
    const info = SCHOOL_TYPES.find(s => s.value === type)!;
    setSchoolType(type);
    setGradeClassCounts(Array(info.grades).fill(info.defaultClasses));
  };

  const adjustGradeCount = (gradeIdx: number, delta: number) => {
    setGradeClassCounts(prev => {
      const next = [...prev];
      next[gradeIdx] = Math.max(1, Math.min(10, (next[gradeIdx] ?? 3) + delta));
      return next;
    });
  };

  const setBulkCount = (count: number) => {
    setGradeClassCounts(Array(grades).fill(count));
  };

  const addCustomClass = () => {
    const raw = customClassInput.trim();
    if (!raw) return;
    const normalized = normalizeClassName(raw);
    if (!normalized) return;
    if (generatedClasses.includes(normalized) || extraClasses.includes(normalized)) {
      setCustomClassError("すでに存在するクラス名です");
      return;
    }
    setExtraClasses(prev => [...prev, normalized]);
    setCustomClassInput("");
    setCustomClassError("");
  };

  const handleSemesterSystemChange = useCallback((sys: SemesterSystem) => {
    setSemesterSystem(sys);
    const maxSem = sys === "semester" ? 2 : 3;
    const newSem = semesterNumber > maxSem ? 1 : semesterNumber;
    setSemesterNumber(newSem as 1 | 2 | 3);
    const defaults = getSemesterDefaults(academicYear, newSem as 1 | 2 | 3, sys);
    setStartDate(defaults.start);
    setEndDate(defaults.end);
  }, [academicYear, semesterNumber]);

  const handleSemesterChange = useCallback((sem: 1 | 2 | 3) => {
    setSemesterNumber(sem);
    const defaults = getSemesterDefaults(academicYear, sem, semesterSystem);
    setStartDate(defaults.start);
    setEndDate(defaults.end);
  }, [academicYear, semesterSystem]);

  const handleAcademicYearChange = useCallback((year: number) => {
    setAcademicYear(year);
    const defaults = getSemesterDefaults(year, semesterNumber, semesterSystem);
    setStartDate(defaults.start);
    setEndDate(defaults.end);
  }, [semesterNumber, semesterSystem]);

  const handleClassChange = (weekday: string, period: number, cls: string | null) => {
    setBaseSchedule(prev => ({ ...prev, [weekday]: { ...prev[weekday], [period]: cls } }));
  };

  const filledCells = Object.values(baseSchedule).reduce(
    (sum, day) => sum + Object.values(day).filter(c => c !== null).length, 0
  );

  const semesterLabel = (() => {
    if (semesterSystem === "semester") {
      return semesterNumber === 1 ? "前期" : "後期";
    }
    return `${semesterNumber}学期`;
  })();

  const title = `${academicYear}年度 ${semesterLabel}${school ? ` (${school})` : ""}`;

  const canGoNext = () => {
    if (step === 2) return startDate && endDate && startDate <= endDate;
    if (step === 4) return true; // 教科設定はスキップ可能
    return true;
  };

  const handleApply = () => {
    // 複週対応: weekCount > 1の場合はbaseSchedulesを構範
    let effectiveBaseSchedule: Record<string, Record<number, string | null>> | undefined;
    let effectiveSubjectSchedule: Record<string, Record<number, string | null>> | undefined;
    let effectiveBaseSchedules: Array<{ label: string; schedule: Record<string, Record<number, string | null>>; subjectSchedule?: Record<string, Record<number, string | null>>; }> | undefined;
    let effectiveWeekCycleStart: string | undefined;
    if (weekCount > 1) {
      effectiveBaseSchedules = baseSchedulesArr.slice(0, weekCount).map((sched, idx) => {
        const weekSubj: Record<string, Record<number, string | null>> = {};
        WEEKDAYS.forEach(d => {
          weekSubj[d.key] = {};
          PERIODS.forEach(p => { weekSubj[d.key][p] = subjectScheduleArr[idx]?.[d.key]?.[p] ?? null; });
        });
        const hasSubj = Object.values(weekSubj).some(day => Object.values(day).some(v => v !== null));
        return { label: WEEK_LABELS_S[idx], schedule: sched, subjectSchedule: hasSubj ? weekSubj : undefined };
      });
      // weekCycleStart: 手動入力があればそれを優先、なければ学期開始日の月曜日を自動設定
      if (weekCycleStartInput) {
        // 手動入力値を月曜日に調整
        const inputD = new Date(weekCycleStartInput + "T00:00:00");
        const inputDow = inputD.getDay();
        const inputDiff = inputDow === 0 ? -6 : 1 - inputDow;
        const inputMonday = new Date(inputD);
        inputMonday.setDate(inputMonday.getDate() + inputDiff);
        effectiveWeekCycleStart = `${inputMonday.getFullYear()}-${String(inputMonday.getMonth() + 1).padStart(2, '0')}-${String(inputMonday.getDate()).padStart(2, '0')}`;
      } else if (startDate) {
        const startD = new Date(startDate + "T00:00:00");
        const dow = startD.getDay();
        const diff = dow === 0 ? -6 : 1 - dow;
        const monday = new Date(startD);
        monday.setDate(monday.getDate() + diff);
        effectiveWeekCycleStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      }
    } else {
      effectiveBaseSchedule = baseSchedule;
      const ss = subjectScheduleArr[0] ?? makeEmptyScheduleS();
      const hasSubj = Object.values(ss).some(day => Object.values(day).some(v => v !== null));
      effectiveSubjectSchedule = hasSubj ? ss : undefined;
    }
    const newSemester: SemesterMeta = {
      semesterNumber,
      semesterSystem,
      startDate,
      endDate,
      hasSaturday,
      hasSunday,
      baseSchedule: effectiveBaseSchedule,
      subjectSchedule: effectiveSubjectSchedule,
      baseSchedules: effectiveBaseSchedules,
      weekCycleStart: effectiveWeekCycleStart,
      schoolType,
      gradeClassCounts: gradeClassCounts.slice(0, grades),
      classList: allClasses,
      customClasses: extraClasses.length > 0 ? extraClasses : undefined,
      homeroomClass: selectedMode === 'homeroom' ? (homeroomClass || undefined) : undefined,
    };
    const from = applyMode === "from" ? applyFromDate : undefined;
    // modeをupdateSettingsに渡してmeta.modeも同時に更新（競合防止）
    updateSettings(newSemester, from, selectedMode);
    toast.success("設定を適用しました");
    onClose();
  };

  const handleClose = () => {
    setStep(1);
    onClose();
  };

  if (!isLoaded) return null;

  const yearOptions = getYearOptions();

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings size={18} />
            時間割の設定を変更
          </DialogTitle>
        </DialogHeader>

        <StepIndicator current={step} total={5} />

        {/* ─── Step 1: Basic Info + Class Config ──────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
              学校名・学期制・年度・学期番号・クラス構成を変更できます。
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">学校名 <span className="text-muted-foreground font-normal">(任意)</span></Label>
              <Input value={school} onChange={e => setSchool(e.target.value)} placeholder="例: ○○小学校" className="h-9" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">学期制</Label>
                <Select value={semesterSystem} onValueChange={v => handleSemesterSystemChange(v as SemesterSystem)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trimester">3学期制（1学期・2学期・3学期）</SelectItem>
                    <SelectItem value="semester">2学期制（前期・後期）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">年度</Label>
                <Select value={String(academicYear)} onValueChange={v => handleAcademicYearChange(Number(v))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    {yearOptions.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}年度</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">学期</Label>
              <Select value={String(semesterNumber)} onValueChange={v => handleSemesterChange(Number(v) as 1 | 2 | 3)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {semesterSystem === "trimester" ? (
                    <>
                      <SelectItem value="1">1学期（4月～7月）</SelectItem>
                      <SelectItem value="2">2学期（9月～12月）</SelectItem>
                      <SelectItem value="3">3学期（1月～3月）</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="1">前期（4月〜9月）</SelectItem>
                      <SelectItem value="2">後期（10月〜3月）</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* ── Mode Selection ──────────────────────────────── */}
            <div className="space-y-3 border-t border-border/50 pt-4">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <BookOpen size={14} />
                使用モード
              </Label>
              <div className="grid grid-cols-1 gap-2">
                {[
                  {
                    value: 'single_subject' as TimetableMode,
                    label: '教科担任モード（従来）',
                    desc: '各コマにクラスを割り当てる。複数クラスを担当する教科担任向け。',
                  },
                  {
                    value: 'homeroom' as TimetableMode,
                    label: '担任モード',
                    desc: '担任クラスを固定し、各コマに教科名を表示する。学級担任向け。',
                  },
                ].map(m => (
                  <div
                    key={m.value}
                    onClick={() => setSelectedMode(m.value)}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
                      selectedMode === m.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 transition-all",
                      selectedMode === m.value ? "border-primary bg-primary" : "border-muted-foreground"
                    )} />
                    <div>
                      <p className="text-sm font-semibold">{m.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Homeroom class selection */}
              {selectedMode === 'homeroom' && (
                <div className="space-y-1.5 pl-1">
                  <Label className="text-xs text-muted-foreground">担任クラス <span className="text-destructive">*</span></Label>
                  <Select value={homeroomClass || "__none__"} onValueChange={v => setHomeroomClass(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="担任クラスを選択..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">— 選択してください —</span>
                      </SelectItem>
                      {effectiveClassList.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedMode === 'homeroom' && !homeroomClass && (
                    <p className="text-xs text-amber-600">担任クラスを設定してください</p>
                  )}
                </div>
              )}
            </div>

            {/* Class Config */}
            <div className="space-y-3 border-t border-border/50 pt-4">
              <Label className="text-sm font-medium">クラス構成</Label>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">学校種別</Label>
                <Select value={schoolType} onValueChange={v => handleSchoolTypeChange(v as SchoolType)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCHOOL_TYPES.map(st => (
                      <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">学年別クラス数</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-muted-foreground">一括:</span>
                    {[2, 3, 4, 5].map(n => (
                      <button
                        key={n}
                        onClick={() => setBulkCount(n)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                      >
                        各{n}組
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">学年</th>
                        <th className="text-center px-3 py-1.5 text-xs font-medium text-muted-foreground">クラス数</th>
                        <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">クラス一覧</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: grades }, (_, i) => {
                        const gradeNum = i + 1;
                        const count = gradeClassCounts[i] ?? 3;
                        const classes = Array.from({ length: count }, (_, j) => `${gradeNum}年${j + 1}組`);
                        return (
                          <tr key={gradeNum} className="border-t border-border/50">
                            <td className="px-3 py-2 font-medium text-sm">{gradeNum}年生</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => adjustGradeCount(i, -1)}
                                  disabled={count <= 1}
                                  className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-muted disabled:opacity-30 transition-colors"
                                >
                                  <Minus size={10} />
                                </button>
                                <span className="w-6 text-center font-bold text-sm">{count}</span>
                                <button
                                  onClick={() => adjustGradeCount(i, 1)}
                                  disabled={count >= 10}
                                  className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-muted disabled:opacity-30 transition-colors"
                                >
                                  <Plus size={10} />
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {classes.map(c => (
                                  <span key={c} className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">
                                    {c}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Custom classes */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">追加クラス（自由記述）</p>
                <div className="flex gap-2">
                  <Input
                    value={customClassInput}
                    onChange={e => { setCustomClassInput(e.target.value); setCustomClassError(""); }}
                    onKeyDown={e => e.key === "Enter" && addCustomClass()}
                    placeholder="例: 特別支援学級、英語グループA"
                    className="h-8 text-sm flex-1"
                  />
                  <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={addCustomClass}>
                    <Plus size={11} />追加
                  </Button>
                </div>
                {customClassError && <p className="text-xs text-red-500">{customClassError}</p>}
                {extraClasses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {extraClasses.map(c => (
                      <span
                        key={c}
                        className="flex items-center gap-1 text-[11px] bg-orange-100 text-orange-700 rounded px-2 py-0.5 cursor-pointer hover:bg-red-100 hover:text-red-600 transition-colors"
                        onClick={() => setExtraClasses(prev => prev.filter(x => x !== c))}
                        title="クリックで削除"
                      >
                        {c} ×
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">変更後のタイトル</p>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  クラス合計: <span className="font-medium text-foreground">{allClasses.length}</span> クラス
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 2: Date & Weekend ──────────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
              始業式・終業式の日付と土日授業の設定を変更します。
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">始業式 <span className="text-destructive">*</span></Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">終業式 <span className="text-destructive">*</span></Label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-9" />
              </div>
            </div>

            {startDate && endDate && startDate > endDate && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
                終業式は始業式より後の日付にしてください
              </div>
            )}

            <div className="space-y-3">
              <p className="text-sm font-medium">週末授業の設定</p>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div>
                  <p className="text-sm font-medium">土曜授業</p>
                  <p className="text-xs text-muted-foreground">毎週土曜日を授業日として追加</p>
                </div>
                <Switch checked={hasSaturday} onCheckedChange={setHasSaturday} />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div>
                  <p className="text-sm font-medium">日曜授業</p>
                  <p className="text-xs text-muted-foreground">毎週日曜日を授業日として追加</p>
                </div>
                <Switch checked={hasSunday} onCheckedChange={setHasSunday} />
              </div>
            </div>
          </div>
        )}

          {/* ─── Step 3: Base Schedule Grid ──────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
              {selectedMode === 'homeroom'
                ? `担任モード: 担任クラス（${homeroomClass || "未設定"}）の基本時間割を設定します。各コマに教科を設定できます（後から変更可能）。`
                : "基本時間割を変更します。各コマに担当クラスを設定してください。"
              }
            </div>

            {/* 複週設定: 週数選択 */}
            {selectedMode !== 'homeroom' && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                <span className="text-sm font-medium shrink-0">週パターン数</span>
                <div className="flex gap-1.5">
                  {([1, 2, 3, 4] as const).map(n => (
                    <button
                      key={n}
                      onClick={() => handleWeekCountChangeS(n)}
                      className={cn(
                        "px-3 py-1 rounded text-xs font-semibold border transition-all",
                        weekCount === n
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      )}
                    >
                      {n === 1 ? "1週（通常）" : `${n}週（${WEEK_LABELS_S.slice(0, n).join("/")}）`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* A週/B週基準日手動入力（2週以上の場合のみ表示） */}
            {selectedMode !== 'homeroom' && weekCount > 1 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50/50">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-blue-800 mb-0.5">A週の開始日（基準日）</p>
                  <p className="text-[11px] text-blue-600/80">A週に当たる月曜日を指定します。空白の場合は学期開始日の週をA週として自動設定します。</p>
                </div>
                <input
                  type="date"
                  value={weekCycleStartInput}
                  onChange={e => setWeekCycleStartInput(e.target.value)}
                  className="text-xs bg-white border border-blue-300 rounded px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                {weekCycleStartInput && (
                  <button
                    onClick={() => setWeekCycleStartInput("")}
                    className="text-[11px] text-blue-500 hover:text-blue-700 underline shrink-0"
                  >
                    自動設定に戻す
                  </button>
                )}
              </div>
            )}

            {/* A週/B週タブ（2週以上の場合のみ表示） */}
            {selectedMode !== 'homeroom' && weekCount > 1 && (
              <div className="flex items-center justify-between border-b border-border">
                <div className="flex gap-1">
                  {WEEK_LABELS_S.slice(0, weekCount).map((label, idx) => {
                    const weekFilled = Object.values(baseSchedulesArr[idx] ?? {}).reduce(
                      (sum, day) => sum + Object.values(day).filter(v => v !== null).length, 0
                    );
                    return (
                      <button
                        key={idx}
                        onClick={() => setActiveWeekTab(idx)}
                        className={cn(
                          "px-4 py-2 text-sm font-semibold border-b-2 transition-all -mb-px",
                          activeWeekTab === idx
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                        )}
                      >
                        {label}
                        {weekFilled > 0 && (
                          <span className="ml-1.5 text-[10px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5">
                            {weekFilled}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* 他の週からコピーボタン */}
                <div className="flex items-center gap-1 pr-2 pb-1">
                  <span className="text-[10px] text-muted-foreground">コピー元:</span>
                  {WEEK_LABELS_S.slice(0, weekCount)
                    .map((label, srcIdx) => ({ label, srcIdx }))
                    .filter(({ srcIdx }) => srcIdx !== activeWeekTab)
                    .map(({ label, srcIdx }) => (
                      <button
                        key={srcIdx}
                        onClick={() => {
                          setBaseSchedulesArr(prev => {
                            const next = [...prev];
                            next[activeWeekTab] = JSON.parse(JSON.stringify(next[srcIdx] ?? makeEmptyScheduleS()));
                            return next;
                          });
                        }}
                        className="px-2 py-0.5 text-[11px] font-medium rounded border border-border bg-muted hover:bg-primary/10 hover:border-primary/40 transition-colors"
                        title={`${label}の内容を現在のタブにコピー`}
                      >
                        [{label}]
                      </button>
                    ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-12 text-xs text-muted-foreground font-medium py-2"></th>
                    {WEEKDAYS.map(d => (
                      <th key={d.key} className="text-center text-xs font-bold py-2 px-1 min-w-[90px]">{d.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERIODS.map(period => (
                    <tr key={period}>
                      <td className="text-center text-xs text-muted-foreground font-bold py-1 border-b border-border/50 w-12">{period}限</td>
                      {WEEKDAYS.map(d => {
                        const cls = baseSchedule[d.key]?.[period] ?? null;
                        return (
                          <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                            {selectedMode === 'homeroom' ? (
                              // Homeroom mode: show fixed class label, no selector needed
                              <div className={cn(
                                "h-8 text-xs px-2 flex items-center rounded",
                                homeroomClass ? "bg-amber-50 text-amber-700 font-medium" : "bg-muted/30 text-muted-foreground/50"
                              )}>
                                {homeroomClass || "—"}
                              </div>
                            ) : (
                              <Select
                                value={cls ?? "__empty__"}
                                onValueChange={v => handleClassChange(d.key, period, v === "__empty__" ? null : v)}
                              >
                                <SelectTrigger className={cn(
                                  "h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0",
                                  cls ? "font-medium" : "text-muted-foreground/50"
                                )}>
                                  <SelectValue>
                                    <span className={cls ? "font-medium" : "text-muted-foreground/40"}>{cls ?? "—"}</span>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent className="max-h-48">
                                  <SelectItem value="__empty__">
                                    <span className="text-muted-foreground">— 空き —</span>
                                  </SelectItem>
                                  {allClasses.map(c => (
                                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedMode === 'homeroom' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                担任モードでは、基本時間割のクラスは自動的に担任クラス（{homeroomClass || "未設定"}）に設定されます。
                教科は週間グリッドの各コマから個別に設定できます。
              </div>
            )}

            {selectedMode !== 'homeroom' && filledCells > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
                <span className="font-medium text-primary">{filledCells}</span> コマの授業が設定されています
              </div>
            )}

            {/* 教科設定セクションは Step4 に移動しました */}
            {false && (
              <div className="border border-border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">教科設定</span>
                  <span className="text-xs text-muted-foreground">各コマに教科を割り当てます</span>
                </div>

                {/* A週/B週タブ (複数週のときのみ) */}
                {weekCount > 1 && (
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <span className="text-xs text-muted-foreground font-medium">週選択:</span>
                    <div className="flex gap-1">
                      {WEEK_LABELS_S.slice(0, weekCount).map((label, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveSubjectTab(idx)}
                          className={cn(
                            "px-3 py-1 text-xs rounded font-medium transition-colors",
                            activeSubjectTab === idx
                              ? "bg-blue-600 text-white"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >{label}</button>
                      ))}
                    </div>
                    <div className="ml-auto flex gap-1">
                      {WEEK_LABELS_S.slice(0, weekCount).filter((_, i) => i !== activeSubjectTab).map((label) => {
                        const srcIdx = WEEK_LABELS_S.indexOf(label);
                        return (
                          <button
                            key={srcIdx}
                            onClick={() => {
                              const src = subjectScheduleArr[srcIdx];
                              if (!src) return;
                              setSubjectScheduleArr(prev => {
                                const next = [...prev];
                                next[activeSubjectTab] = JSON.parse(JSON.stringify(src));
                                return next;
                              });
                            }}
                            className="text-[10px] px-2 py-0.5 rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                          >
                            {label}からコピー
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 一括設定ツール */}
                <div className="flex flex-wrap gap-2 p-2 bg-muted/20 rounded border border-border">
                  <span className="text-xs text-muted-foreground font-medium self-center">一括:</span>
                  {Array.from(new Set(allClasses.map(c => {
                    const m = c.match(/(\d+)年/);
                    return m ? parseInt(m[1]) : null;
                  }).filter((g): g is number => g !== null))).sort().map(grade => (
                    <div key={grade} className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{grade}年:</span>
                      {subjects.map(s => (
                        <button
                          key={s.name}
                          onClick={() => {
                            const gradeClasses = allClasses.filter(c => c.startsWith(`${grade}年`));
                            const currentBase = baseSchedulesArr[activeSubjectTab] ?? makeEmptyScheduleS();
                            setCurrentSubjectSchedule(prev => {
                              const next = { ...prev };
                              WEEKDAYS.forEach(d => {
                                next[d.key] = { ...next[d.key] };
                                PERIODS.forEach(p => {
                                  const cls = currentBase[d.key]?.[p];
                                  if (cls && gradeClasses.includes(cls)) {
                                    next[d.key][p] = s.name;
                                  }
                                });
                              });
                              return next;
                            });
                          }}
                          className="text-[10px] px-2 py-0.5 rounded border font-medium transition-colors hover:opacity-80"
                          style={{
                            backgroundColor: s.color ? `${s.color}20` : '#f0f0f0',
                            color: s.color ?? '#666',
                            borderColor: s.color ? `${s.color}50` : '#ccc',
                          }}
                        >
                          {grade}年→{s.name}
                        </button>
                      ))}
                    </div>
                  ))}
                  <button
                    onClick={() => setCurrentSubjectSchedule(prev => {
                      const next = { ...prev };
                      WEEKDAYS.forEach(d => {
                        next[d.key] = { ...next[d.key] };
                        PERIODS.forEach(p => { next[d.key][p] = null; });
                      });
                      return next;
                    })}
                    className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted transition-colors ml-auto"
                  >
                    リセット
                  </button>
                </div>

                {/* 教科設定グリッド */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="w-12 text-xs text-muted-foreground font-medium py-2" />
                        {WEEKDAYS.map(d => (
                          <th key={d.key} className="text-center text-xs font-bold py-2 px-1 min-w-[90px]">{d.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PERIODS.map(period => (
                        <tr key={period}>
                          <td className="text-center text-xs text-muted-foreground font-bold py-1 border-b border-border/50 w-12">{period}限</td>
                          {WEEKDAYS.map(d => {
                            const currentBase = baseSchedulesArr[activeSubjectTab] ?? makeEmptyScheduleS();
                            const cls = currentBase[d.key]?.[period] ?? null;
                            const subj = currentSubjectSchedule[d.key]?.[period] ?? null;
                            if (!cls) {
                              return (
                                <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                                  <div className="h-8 text-xs px-1 flex items-center justify-center rounded bg-muted/20 text-muted-foreground/30">—</div>
                                </td>
                              );
                            }
                            return (
                              <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                                <Select
                                  value={subj ?? "__empty__"}
                                  onValueChange={v => setCurrentSubjectSchedule(prev => ({
                                    ...prev,
                                    [d.key]: { ...prev[d.key], [period]: v === "__empty__" ? null : v }
                                  }))}
                                >
                                  <SelectTrigger className={cn(
                                    "h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0",
                                    subj ? "font-semibold text-blue-700" : "text-muted-foreground/50"
                                  )}>
                                    <SelectValue>
                                      <span className={subj ? "font-semibold text-blue-700" : "text-muted-foreground/40"}>
                                        {subj ?? cls}
                                      </span>
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent className="max-h-48">
                                    <SelectItem value="__empty__">
                                      <span className="text-muted-foreground">— 未設定 —</span>
                                    </SelectItem>
                                    {subjects.map(s => (
                                      <SelectItem key={s.name} value={s.name} className="text-xs">
                                        <span style={{ color: s.color }}>{s.name}</span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div className="text-[9px] text-center text-muted-foreground/50 mt-0.5">{cls}</div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        {/* ─── Step 4: 教科設定 ────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
              各コマに教科を割り当てます。設定しなくても次のステップに進めます。
            </div>

            {subjects.length < 1 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                教科が登録されていません。「教科の管理」から教科を登録してから再度この画面を開いてください。
              </div>
            )}

            {subjects.length >= 1 && (
              <div className="border border-border rounded-lg p-3 space-y-3">
                {/* A週/B週タブ (複数週のときのみ) */}
                {weekCount > 1 && (
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <span className="text-xs text-muted-foreground font-medium">週選択:</span>
                    <div className="flex gap-1">
                      {WEEK_LABELS_S.slice(0, weekCount).map((label, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveSubjectTab(idx)}
                          className={cn(
                            "px-3 py-1 text-xs rounded font-medium transition-colors",
                            activeSubjectTab === idx
                              ? "bg-blue-600 text-white"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >{label}</button>
                      ))}
                    </div>
                    <div className="ml-auto flex gap-1">
                      {WEEK_LABELS_S.slice(0, weekCount).filter((_, i) => i !== activeSubjectTab).map((label) => {
                        const srcIdx = WEEK_LABELS_S.indexOf(label);
                        return (
                          <button
                            key={srcIdx}
                            onClick={() => {
                              const src = subjectScheduleArr[srcIdx];
                              if (!src) return;
                              setSubjectScheduleArr(prev => {
                                const next = [...prev];
                                next[activeSubjectTab] = JSON.parse(JSON.stringify(src));
                                return next;
                              });
                            }}
                            className="text-[10px] px-2 py-0.5 rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                          >
                            {label}からコピー
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 一括設定ツール */}
                {subjects.length >= 2 && (
                  <div className="flex flex-wrap gap-2 p-2 bg-muted/20 rounded border border-border">
                    <span className="text-xs text-muted-foreground font-medium self-center">一括:</span>
                    {Array.from(new Set(allClasses.map(c => {
                      const m = c.match(/(\d+)年/);
                      return m ? parseInt(m[1]) : null;
                    }).filter((g): g is number => g !== null))).sort().map(grade => (
                      <div key={grade} className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">{grade}年:</span>
                        {subjects.map(s => (
                          <button
                            key={s.name}
                            onClick={() => {
                              const gradeClasses = allClasses.filter(c => c.startsWith(`${grade}年`));
                              const currentBase = baseSchedulesArr[activeSubjectTab] ?? makeEmptyScheduleS();
                              setCurrentSubjectSchedule(prev => {
                                const next = { ...prev };
                                WEEKDAYS.forEach(d => {
                                  next[d.key] = { ...next[d.key] };
                                  PERIODS.forEach(p => {
                                    const cls = currentBase[d.key]?.[p];
                                    if (cls && gradeClasses.includes(cls)) {
                                      next[d.key][p] = s.name;
                                    }
                                  });
                                });
                                return next;
                              });
                            }}
                            className="text-[10px] px-2 py-0.5 rounded border font-medium transition-colors hover:opacity-80"
                            style={{
                              backgroundColor: s.color ? `${s.color}20` : '#f0f0f0',
                              color: s.color ?? '#666',
                              borderColor: s.color ? `${s.color}50` : '#ccc',
                            }}
                          >
                            {grade}年→{s.name}
                          </button>
                        ))}
                      </div>
                    ))}
                    <button
                      onClick={() => setCurrentSubjectSchedule(prev => {
                        const next = { ...prev };
                        WEEKDAYS.forEach(d => {
                          next[d.key] = { ...next[d.key] };
                          PERIODS.forEach(p => { next[d.key][p] = null; });
                        });
                        return next;
                      })}
                      className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted transition-colors ml-auto"
                    >
                      リセット
                    </button>
                  </div>
                )}

                {/* 教科設定グリッド */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="w-12 text-xs text-muted-foreground font-medium py-2" />
                        {WEEKDAYS.map(d => (
                          <th key={d.key} className="text-center text-xs font-bold py-2 px-1 min-w-[90px]">{d.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PERIODS.map(period => (
                        <tr key={period}>
                          <td className="text-center text-xs text-muted-foreground font-bold py-1 border-b border-border/50 w-12">{period}限</td>
                          {WEEKDAYS.map(d => {
                            const currentBase = baseSchedulesArr[activeSubjectTab] ?? makeEmptyScheduleS();
                            const cls = currentBase[d.key]?.[period] ?? null;
                            const subj = currentSubjectSchedule[d.key]?.[period] ?? null;
                            if (!cls) {
                              return (
                                <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                                  <div className="h-8 text-xs px-1 flex items-center justify-center rounded bg-muted/20 text-muted-foreground/30">—</div>
                                </td>
                              );
                            }
                            return (
                              <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                                <Select
                                  value={subj ?? "__empty__"}
                                  onValueChange={v => setCurrentSubjectSchedule(prev => ({
                                    ...prev,
                                    [d.key]: { ...prev[d.key], [period]: v === "__empty__" ? null : v }
                                  }))}
                                >
                                  <SelectTrigger className={cn(
                                    "h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0",
                                    subj ? "font-semibold text-blue-700" : "text-muted-foreground/50"
                                  )}>
                                    <SelectValue>
                                      <span className={subj ? "font-semibold text-blue-700" : "text-muted-foreground/40"}>
                                        {subj ?? cls}
                                      </span>
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent className="max-h-48">
                                    <SelectItem value="__empty__">
                                      <span className="text-muted-foreground">— 未設定 —</span>
                                    </SelectItem>
                                    {subjects.map(s => (
                                      <SelectItem key={s.name} value={s.name} className="text-xs">
                                        <span style={{ color: s.color }}>{s.name}</span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div className="text-[9px] text-center text-muted-foreground/50 mt-0.5">{cls}</div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 5: Apply Mode ────────────────────────────────────── */}
        {step === 5 && (      <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
              変更の適用範囲を選択してください。
            </div>

            {/* Mode summary */}
            <div className="bg-card border border-border rounded-lg p-3 text-xs">
              <p className="text-muted-foreground mb-1">適用されるモード</p>
              <p className="font-semibold">
                {selectedMode === 'single_subject' && '教科担任モード（従来）'}
                {selectedMode === 'homeroom' && `担任モード${homeroomClass ? ` — ${homeroomClass}` : ''}`}
                {selectedMode === 'multi_subject' && '複数教科モード'}
              </p>
            </div>

            <div className="space-y-3">
              {/* All */}
              <div
                onClick={() => setApplyMode("all")}
                className={cn(
                  "flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
                  applyMode === "all"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 transition-all",
                  applyMode === "all" ? "border-primary bg-primary" : "border-muted-foreground"
                )} />
                <div className="flex-1">
                  <p className="text-sm font-semibold">学期全体に適用</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    baseデータを全期間で再生成します。既存の個別変更（override）はそのまま保持されます。
                  </p>
                </div>
              </div>

              {/* From date */}
              <div
                onClick={() => setApplyMode("from")}
                className={cn(
                  "flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
                  applyMode === "from"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 transition-all",
                  applyMode === "from" ? "border-primary bg-primary" : "border-muted-foreground"
                )} />
                <div className="flex-1">
                  <p className="text-sm font-semibold">指定日以降に適用</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    担当変更などに対応。指定日以降のbaseデータのみ再生成します。
                    指定日以降の個別変更は削除されます。
                  </p>
                  {applyMode === "from" && (
                    <div className="mt-3">
                      <Label className="text-xs text-muted-foreground mb-1 block">適用開始日</Label>
                      <Input
                        type="date"
                        value={applyFromDate}
                        onChange={e => setApplyFromDate(e.target.value)}
                        min={startDate}
                        max={endDate}
                        className="h-8 text-sm w-48"
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                  )}
                </div>
              </div>

              {applyMode === "from" && applyFromDate && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700">
                    <strong>{applyFromDate}</strong> 以降の個別変更（削除・追加・移動など）は削除されます。
                    この操作はUndo履歴もリセットされます。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Navigation ─────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => step > 1 ? setStep(s => s - 1) : handleClose()}
            className="gap-1.5"
          >
            <ChevronLeft size={14} />
            {step > 1 ? "戻る" : "キャンセル"}
          </Button>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{step} / 5</span>
            {step < 5 ? (
              <Button size="sm" onClick={() => setStep(s => s + 1)} disabled={!canGoNext()} className="gap-1.5">
                次へ <ChevronRight size={14} />
              </Button>
            ) : (
              <Button size="sm" onClick={handleApply} className="gap-1.5 bg-primary">
                <Check size={13} />
                設定を適用
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
