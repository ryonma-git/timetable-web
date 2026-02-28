// Design: Swiss Grid × Japanese Functional Design
// 4-step wizard for creating a new timetable (semester unit)
// Step 1: School/year/semester metadata + school type + class setup + mode selection
// Step 2: Saturday/Sunday class settings
// Step 3: Base schedule grid (weekday × period → class, or homeroom on/off)
// Step 4 [homeroom only]: Subject schedule (weekday × period → subject)
// Step 5: Confirmation and creation
// Phase 4: モード選択・担任クラス設定・教科基礎時間割設定を追加

import { useState, useCallback } from "react";
import {
  FilePlus,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  School,
  Calendar,
  CalendarDays,
  Grid3X3,
  Plus,
  Minus,
  BookOpen,
  BookMarked,
  X,
  Clock,
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
import { PeriodTimesDialog, PeriodTimesDialogStandalone } from "@/components/PeriodTimesDialog";
import { generateBaseEntries, createNewTimetableFile, SemesterMeta, TimetableMode, SemesterSystem, SubjectDef, HolidayEntry } from "@/lib/timetableFile";
import Holidays from "date-holidays";
import { useTimetable } from "@/contexts/TimetableContext";
import { normalizeClassName, classSort, generateDefaultClasses, SchoolType } from "@/lib/timetable";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Weekday columns in order
const WEEKDAYS = [
  { key: "Mon", label: "月" },
  { key: "Tue", label: "火" },
  { key: "Wed", label: "水" },
  { key: "Thu", label: "木" },
  { key: "Fri", label: "金" },
];

const PERIODS = [1, 2, 3, 4, 5, 6];

// Default subjects for homeroom mode
const DEFAULT_SUBJECTS: SubjectDef[] = [
  { name: "国語", color: "#ef4444" },
  { name: "算数", color: "#3b82f6" },
  { name: "理科", color: "#22c55e" },
  { name: "社会", color: "#eab308" },
  { name: "英語", color: "#8b5cf6" },
  { name: "音楽", color: "#ec4899" },
  { name: "図工", color: "#065f46" },
  { name: "体育", color: "#f97316" },
  { name: "生活", color: "#84cc16" },
  { name: "道徳", color: "#f59e0b" },
  { name: "総合", color: "#6366f1" },
  { name: "学活", color: "#64748b" },
  { name: "図書", color: "#0891b2" },
  { name: "クラブ", color: "#7c3aed" },
  { name: "委員会", color: "#b45309" },
  { name: "書写", color: "#374151" },
  { name: "自習", color: "#6b7280" },
  { name: "PC", color: "#0f766e" },
  { name: "数学", color: "#1d4ed8" },
  { name: "家庭科", color: "#be185d" },
  { name: "技術", color: "#92400e" },
  { name: "情報", color: "#0369a1" },
  { name: "保健", color: "#b91c1c" },
  { name: "外国語活動", color: "#6d28d9" },
];

// School type definitions
const SCHOOL_TYPES: { value: SchoolType; label: string; grades: number; defaultClasses: number }[] = [
  { value: "elementary", label: "小学校（6年制）", grades: 6, defaultClasses: 3 },
  { value: "junior", label: "中学校（3年制）", grades: 3, defaultClasses: 3 },
  { value: "high", label: "高等学校（3年制）", grades: 3, defaultClasses: 3 },
];

// Compute default academic year from current date
function getDefaultAcademicYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 4 ? year : year - 1;
}

// Generate year options: 2024 to current+30
function getYearOptions(): number[] {
  const max = getDefaultAcademicYear() + 30;
  const years: number[] = [];
  for (let y = 2024; y <= max; y++) years.push(y);
  return years;
}

// Semester default date ranges
function getSemesterDefaults(year: number, semester: 1 | 2 | 3, system: SemesterSystem = "trimester") {
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

// Step indicator component
function StepIndicator({ current, total, isHomeroom, isSubjectTeacher }: { current: number; total: number; isHomeroom: boolean; isSubjectTeacher?: boolean }) {
  const baseSteps = [
    { icon: <School size={14} />, label: "学校情報" },
    { icon: <Calendar size={14} />, label: "授業日設定" },
    { icon: <Grid3X3 size={14} />, label: "基本時間割" },
    { icon: <Check size={14} />, label: "確認・作成" },
  ];
  const homeroomSteps = [
    { icon: <School size={14} />, label: "学校情報" },
    { icon: <Calendar size={14} />, label: "授業日設定" },
    { icon: <Grid3X3 size={14} />, label: "授業コマ設定" },
    { icon: <BookMarked size={14} />, label: "教科設定" },
    { icon: <Check size={14} />, label: "確認・作成" },
  ];
  const subjectTeacherSteps = [
    { icon: <School size={14} />, label: "学校情報" },
    { icon: <Calendar size={14} />, label: "授業日設定" },
    { icon: <Grid3X3 size={14} />, label: "基本時間割" },
    { icon: <BookMarked size={14} />, label: "教科設定" },
    { icon: <Check size={14} />, label: "確認・作成" },
  ];
  const steps = isHomeroom ? homeroomSteps : isSubjectTeacher ? subjectTeacherSteps : baseSteps;

  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((step, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === current;
        const isDone = stepNum < current;
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all",
                  isActive && "bg-primary text-primary-foreground border-primary",
                  isDone && "bg-primary/20 text-primary border-primary/50",
                  !isActive && !isDone && "bg-muted text-muted-foreground border-border"
                )}
              >
                {isDone ? <Check size={12} /> : step.icon}
              </div>
              <span className={cn(
                "text-[9px] font-medium whitespace-nowrap",
                isActive ? "text-primary" : "text-muted-foreground"
              )}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn(
                "h-0.5 w-6 mx-1 mb-4 transition-all",
                stepNum < current ? "bg-primary/50" : "bg-border"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function NewFileWizard({ open, onClose }: Props) {
  const { loadTimetableFile, goToDate } = useTimetable();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Metadata
  const [school, setSchool] = useState("");
  const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
  const [semesterSystem, setSemesterSystem] = useState<SemesterSystem>("trimester");
  const [semesterNumber, setSemesterNumber] = useState<1 | 2 | 3>(1);

  // Step 1: School type & class setup
  const [schoolType, setSchoolType] = useState<SchoolType>("elementary");
  const [gradeClassCounts, setGradeClassCounts] = useState<number[]>([3, 3, 3, 3, 3, 3]); // 6 grades
  const [customClassInput, setCustomClassInput] = useState("");
  const [customClassError, setCustomClassError] = useState("");
  const [extraClasses, setExtraClasses] = useState<string[]>([]);

  // Step 1: Mode selection
  const [selectedMode, setSelectedMode] = useState<TimetableMode>('single_subject');
  const [homeroomClass, setHomeroomClass] = useState("");
  // 教科担任モード: 担当教科リスト（数で single/multi を自動判定）
  const [subjectTeacherSubjects, setSubjectTeacherSubjects] = useState<SubjectDef[]>([]);
  const [subjectTeacherInput, setSubjectTeacherInput] = useState("");
  const [subjectTeacherError, setSubjectTeacherError] = useState("");

  // Step 2: Date range & weekend settings
  const [startDate, setStartDate] = useState(() => getSemesterDefaults(academicYear, 1).start);
  const [endDate, setEndDate] = useState(() => getSemesterDefaults(academicYear, 1).end);
  const [hasSaturday, setHasSaturday] = useState(false);
  const [hasSunday, setHasSunday] = useState(false);
  // 祝日を自動で休校日に設定するか
  const [autoSetHolidays, setAutoSetHolidays] = useState(true);
  // 時程表（各コマの開始・終了時刻）
  const [wizardPeriodTimes, setWizardPeriodTimes] = useState<Record<number, { start: string; end: string }> | undefined>(undefined);
  const [wizardPeriodTimesByDay, setWizardPeriodTimesByDay] = useState<Record<string, Record<number, { start: string; end: string }>> | undefined>(undefined);
  const [showPeriodTimesInWizard, setShowPeriodTimesInWizard] = useState(false);

  // Step 3: Base schedule (for single_subject mode: class per slot; for homeroom: on/off per slot)
  const [baseSchedule, setBaseSchedule] = useState<Record<string, Record<number, string | null>>>(() => {
    const schedule: Record<string, Record<number, string | null>> = {};
    WEEKDAYS.forEach(d => {
      schedule[d.key] = {};
      PERIODS.forEach(p => { schedule[d.key][p] = null; });
    });
    return schedule;
  });

  // Step 3 (homeroom mode): which slots have class (true = homeroomClass, false = null)
  const [homeroomSlots, setHomeroomSlots] = useState<Record<string, Record<number, boolean>>>(() => {
    const slots: Record<string, Record<number, boolean>> = {};
    WEEKDAYS.forEach(d => {
      slots[d.key] = {};
      // Default: Mon-Fri periods 1-6 all ON
      PERIODS.forEach(p => { slots[d.key][p] = true; });
    });
    return slots;
  });

  // Step 3 (homeroom mode): per-slot class override (null = use homeroomClass)
  const [homeroomSlotOverrides, setHomeroomSlotOverrides] = useState<Record<string, Record<number, string | null>>>(() => {
    const overrides: Record<string, Record<number, string | null>> = {};
    WEEKDAYS.forEach(d => {
      overrides[d.key] = {};
      PERIODS.forEach(p => { overrides[d.key][p] = null; }); // null = use homeroomClass
    });
    return overrides;
  });

  const setHomeroomSlotClass = (weekday: string, period: number, cls: string | null) => {
    setHomeroomSlotOverrides(prev => ({
      ...prev,
      [weekday]: { ...prev[weekday], [period]: cls },
    }));
  };

  // Step 4 (homeroom mode): subject per slot (only for slots that are ON)
  const [subjectSchedule, setSubjectSchedule] = useState<Record<string, Record<number, string | null>>>(() => {
    const schedule: Record<string, Record<number, string | null>> = {};
    WEEKDAYS.forEach(d => {
      schedule[d.key] = {};
      PERIODS.forEach(p => { schedule[d.key][p] = null; });
    });
    return schedule;
  });

  // Step 4: subjects list (starts with defaults, user can add/remove)
  const [subjects, setSubjects] = useState<SubjectDef[]>(DEFAULT_SUBJECTS);
  const [newSubjectInput, setNewSubjectInput] = useState("");
  const [newSubjectError, setNewSubjectError] = useState("");

  // Derived: current school type info
  const schoolTypeInfo = SCHOOL_TYPES.find(s => s.value === schoolType) ?? SCHOOL_TYPES[0];
  const grades = schoolTypeInfo.grades;
  const isHomeroomMode = selectedMode === 'homeroom';
  const isSubjectTeacherMode = selectedMode === 'single_subject' || selectedMode === 'multi_subject';
  // Total steps: homeroom has 5, subject teacher has 5, others have 4
  const totalSteps = (isHomeroomMode || isSubjectTeacherMode) ? 5 : 4;
  // Confirmation step number
  const confirmStep = totalSteps;

  // When school type changes, reset gradeClassCounts
  const handleSchoolTypeChange = (type: SchoolType) => {
    const info = SCHOOL_TYPES.find(s => s.value === type)!;
    setSchoolType(type);
    setGradeClassCounts(Array(info.grades).fill(info.defaultClasses));
    setHomeroomClass(""); // reset homeroom class
  };

  // Adjust class count for a grade
  const adjustGradeCount = (gradeIdx: number, delta: number) => {
    setGradeClassCounts(prev => {
      const next = [...prev];
      next[gradeIdx] = Math.max(1, Math.min(10, (next[gradeIdx] ?? 3) + delta));
      return next;
    });
  };

  // Bulk set all grades to same count
  const setBulkCount = (count: number) => {
    setGradeClassCounts(Array(grades).fill(count));
  };

  // Add custom class
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

  // All generated classes (standard + extra, sorted)
  const generatedClasses = generateDefaultClasses(schoolType, gradeClassCounts.slice(0, grades));
  const allClasses = [...generatedClasses, ...extraClasses].sort(classSort);

  // Update dates when semester changes
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
    setBaseSchedule(prev => ({
      ...prev,
      [weekday]: { ...prev[weekday], [period]: cls },
    }));
  };

  // Toggle homeroom slot on/off
  const toggleHomeroomSlot = (weekday: string, period: number) => {
    setHomeroomSlots(prev => ({
      ...prev,
      [weekday]: { ...prev[weekday], [period]: !prev[weekday]?.[period] },
    }));
    // If turning off, clear subject
    if (homeroomSlots[weekday]?.[period]) {
      setSubjectSchedule(prev => ({
        ...prev,
        [weekday]: { ...prev[weekday], [period]: null },
      }));
    }
  };

  // Set subject for a slot
  const handleSubjectChange = (weekday: string, period: number, subject: string | null) => {
    setSubjectSchedule(prev => ({
      ...prev,
      [weekday]: { ...prev[weekday], [period]: subject },
    }));
  };

  // Add new subject
  const addSubject = (name?: string) => {
    const raw = (name ?? newSubjectInput).trim();
    if (!raw) return;
    if (subjects.some(s => s.name === raw)) {
      if (!name) setNewSubjectError("すでに存在する教科名です");
      return;
    }
    setSubjects(prev => [...prev, { name: raw }]);
    if (!name) {
      setNewSubjectInput("");
      setNewSubjectError("");
    }
  };

  // Add all default subjects at once
  const addAllDefaultSubjects = () => {
    DEFAULT_SUBJECTS.forEach(s => {
      if (!subjects.some(x => x.name === s.name)) {
        setSubjects(prev => [...prev, s]);
      }
    });
  };

  // State for inline subject add in dropdown
  const [inlineSubjectInput, setInlineSubjectInput] = useState("");
  const [addingSubjectForCell, setAddingSubjectForCell] = useState<{ weekday: string; period: number } | null>(null);
  const addInlineSubject = (weekday: string, period: number) => {
    const raw = inlineSubjectInput.trim();
    if (!raw) return;
    if (!subjects.some(s => s.name === raw)) {
      setSubjects(prev => [...prev, { name: raw }]);
    }
    handleSubjectChange(weekday, period, raw);
    setInlineSubjectInput("");
    setAddingSubjectForCell(null);
  };

  // Remove subject
  const removeSubject = (name: string) => {
    setSubjects(prev => prev.filter(s => s.name !== name));
    // Clear any slots using this subject
    setSubjectSchedule(prev => {
      const next = { ...prev };
      WEEKDAYS.forEach(d => {
        next[d.key] = { ...next[d.key] };
        PERIODS.forEach(p => {
          if (next[d.key][p] === name) next[d.key][p] = null;
        });
      });
      return next;
    });
  };

  // Count filled cells
  const filledCells = Object.values(baseSchedule).reduce((sum, day) =>
    sum + Object.values(day).filter(c => c !== null).length, 0
  );

  // Count homeroom ON slots
  const homeroomOnCount = Object.values(homeroomSlots).reduce((sum, day) =>
    sum + Object.values(day).filter(Boolean).length, 0
  );

  // Count subject-assigned slots
  const subjectFilledCount = Object.values(subjectSchedule).reduce((sum, day) =>
    sum + Object.values(day).filter(s => s !== null).length, 0
  );

  // Title derived from inputs
  const semesterLabel = semesterSystem === "semester"
    ? (semesterNumber === 1 ? "前期" : "後期")
    : `${semesterNumber}学期`;
  const title = `${academicYear}年度 ${semesterLabel}${school ? ` (${school})` : ""}`;

  // 教科担任モード: 担当教科を追加
  const addSubjectTeacherSubject = (name?: string) => {
    const raw = (name ?? subjectTeacherInput).trim();
    if (!raw) return;
    if (subjectTeacherSubjects.some(s => s.name === raw)) {
      if (!name) setSubjectTeacherError("すでに追加されています");
      return;
    }
    const defaultColor = DEFAULT_SUBJECTS.find(s => s.name === raw)?.color;
    setSubjectTeacherSubjects(prev => [...prev, { name: raw, color: defaultColor }]);
    if (!name) { setSubjectTeacherInput(""); setSubjectTeacherError(""); }
  };

  const removeSubjectTeacherSubject = (name: string) => {
    setSubjectTeacherSubjects(prev => prev.filter(s => s.name !== name));
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      let effectiveBaseSchedule: Record<string, Record<number, string | null>>;
      let effectiveSubjectSchedule: Record<string, Record<number, string | null>> | undefined;

      if (isHomeroomMode) {
        // Build base schedule from homeroomSlots (on = homeroomClass or empty string, off = null)
        // homeroomClassが未設定でも担任モードの処理を行う
        effectiveBaseSchedule = {};
        WEEKDAYS.forEach(d => {
          effectiveBaseSchedule[d.key] = {};
          PERIODS.forEach(p => {
            if (!homeroomSlots[d.key]?.[p]) {
              // OFFスロット
              effectiveBaseSchedule[d.key][p] = null;
            } else {
              // ONスロット: overrideがあればoverride、なければhomeroomClass
              const override = homeroomSlotOverrides[d.key]?.[p];
              effectiveBaseSchedule[d.key][p] = override !== null ? override : (homeroomClass || null);
            }
          });
        });
        // Subject schedule (only for ON slots)
        effectiveSubjectSchedule = {};
        WEEKDAYS.forEach(d => {
          effectiveSubjectSchedule![d.key] = {};
          PERIODS.forEach(p => {
            if (homeroomSlots[d.key]?.[p]) {
              effectiveSubjectSchedule![d.key][p] = subjectSchedule[d.key]?.[p] ?? null;
            } else {
              effectiveSubjectSchedule![d.key][p] = null;
            }
          });
        });
      } else if (isSubjectTeacherMode) {
        // 教科担任モード: baseScheduleをそのまま使用
        effectiveBaseSchedule = baseSchedule;
        // subjectScheduleを構築
        if (subjectTeacherSubjects.length === 1) {
          // 単数教科: 全コマに担当教科を自動適用
          const singleSubjectName = subjectTeacherSubjects[0].name;
          effectiveSubjectSchedule = {};
          WEEKDAYS.forEach(d => {
            effectiveSubjectSchedule![d.key] = {};
            PERIODS.forEach(p => {
              // クラスが設定されているコマのみ教科を適用
              effectiveSubjectSchedule![d.key][p] = baseSchedule[d.key]?.[p] ? singleSubjectName : null;
            });
          });
        } else if (subjectTeacherSubjects.length >= 2) {
          // 複数教科: subjectScheduleグリッドで設定した内容を使用
          effectiveSubjectSchedule = {};
          WEEKDAYS.forEach(d => {
            effectiveSubjectSchedule![d.key] = {};
            PERIODS.forEach(p => {
              effectiveSubjectSchedule![d.key][p] = subjectSchedule[d.key]?.[p] ?? null;
            });
          });
        }
      } else {
        effectiveBaseSchedule = baseSchedule;
      }

      const base = generateBaseEntries(startDate, endDate, {
        hasSaturday,
        hasSunday,
        baseSchedule: effectiveBaseSchedule,
        subjectSchedule: effectiveSubjectSchedule,
      });

      const file = createNewTimetableFile(title, school || undefined, `${academicYear}年度`);

      // Set mode on meta
      file.meta.mode = selectedMode;

      // Set subjects
      if (isHomeroomMode) {
        file.subjects = subjects;
      } else if (isSubjectTeacherMode && subjectTeacherSubjects.length > 0) {
        file.subjects = subjectTeacherSubjects;
        // 教科数で内部モードを自動判定
        file.meta.mode = subjectTeacherSubjects.length === 1 ? 'single_subject' : 'multi_subject';
      }

      // 祝日自動取得
      let autoHolidayEntries: HolidayEntry[] = [];
      if (autoSetHolidays && startDate && endDate) {
        const hd = new Holidays("JP");
        const start = new Date(startDate);
        const end = new Date(endDate);
        const years = new Set<number>();
        for (let y = start.getFullYear(); y <= end.getFullYear(); y++) years.add(y);
        years.forEach(year => {
          hd.getHolidays(year).forEach(h => {
            if (h.type !== "public") return;
            const d = new Date(h.date);
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            if (iso >= startDate && iso <= endDate) {
              autoHolidayEntries.push({ date: iso, name: h.name });
            }
          });
        });
        autoHolidayEntries.sort((a, b) => a.date.localeCompare(b.date));
      }

      const semester: SemesterMeta = {
        semesterNumber,
        semesterSystem,
        startDate,
        endDate,
        hasSaturday,
        hasSunday,
        baseSchedule: effectiveBaseSchedule,
        subjectSchedule: effectiveSubjectSchedule,
        schoolType,
        gradeClassCounts: gradeClassCounts.slice(0, grades),
        classList: allClasses,
        customClasses: extraClasses,
        homeroomClass: isHomeroomMode ? (homeroomClass || undefined) : undefined,
        holidays: autoHolidayEntries.length > 0 ? autoHolidayEntries : undefined,
        periodTimes: wizardPeriodTimes && Object.keys(wizardPeriodTimes).length > 0 ? wizardPeriodTimes : undefined,
        periodTimesByDay: wizardPeriodTimesByDay && Object.keys(wizardPeriodTimesByDay).length > 0 ? wizardPeriodTimesByDay : undefined,
      };
      file.semester = semester;
      file.base = base;

      await loadTimetableFile(file);
      // 学期開始日の週に移動（今日ではなく設定した学期の始まりを表示）
      if (startDate) {
        goToDate(new Date(startDate));
      }
      handleClose();
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    onClose();
  };

  const canGoNext = () => {
    if (step === 1) {
      if (isHomeroomMode && !homeroomClass) return false;
      return true;
    }
    if (step === 2) return startDate && endDate && startDate <= endDate;
    if (step === 3) return true;
    if (step === 4 && (isHomeroomMode || isSubjectTeacherMode)) return true; // subject step is optional
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus size={18} />
            新規時間割を作成
          </DialogTitle>
        </DialogHeader>

        <StepIndicator current={step} total={totalSteps} isHomeroom={isHomeroomMode} isSubjectTeacher={isSubjectTeacherMode} />

        {/* ─── Step 1: School Info + Class Setup + Mode ──────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
              学校名・年度・学期・クラス構成・使用モードを設定します。これらは後から変更できます。
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">学校名 <span className="text-muted-foreground font-normal">(任意)</span></Label>
              <Input
                value={school}
                onChange={e => setSchool(e.target.value)}
                placeholder="例: ○○小学校"
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">学校種別 <span className="text-destructive">*</span></Label>
              <Select value={schoolType} onValueChange={v => handleSchoolTypeChange(v as SchoolType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHOOL_TYPES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">学期制 <span className="text-destructive">*</span></Label>
              <Select value={semesterSystem} onValueChange={v => handleSemesterSystemChange(v as SemesterSystem)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trimester">3学期制（1学期・2学期・3学期）</SelectItem>
                  <SelectItem value="semester">2学期制（前期・後期）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">年度 <span className="text-destructive">*</span></Label>
                <Select
                  value={String(academicYear)}
                  onValueChange={v => handleAcademicYearChange(Number(v))}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    {getYearOptions().map(y => (
                      <SelectItem key={y} value={String(y)}>{y}年度</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">学期 <span className="text-destructive">*</span></Label>
                <Select
                  value={String(semesterNumber)}
                  onValueChange={v => handleSemesterChange(Number(v) as 1 | 2 | 3)}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {semesterSystem === "trimester" ? (
                      <>
                        <SelectItem value="1">1学期（4月〜7月）</SelectItem>
                        <SelectItem value="2">2学期（9月〜12月）</SelectItem>
                        <SelectItem value="3">3学期（1月〜3月）</SelectItem>
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
            </div>

            {/* ── Mode Selection ──────────────────────────────── */}
            <div className="space-y-3 border-t border-border/50 pt-4">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <BookOpen size={14} />
                使用モード <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-1 gap-2">
                {[
                  {
                    value: 'single_subject' as TimetableMode,
                    label: '教科担任モード',
                    desc: '複数クラスを担当する教科担任向け。各コマにクラスを割り当て、担当教科を登録できます。',
                  },
                  {
                    value: 'homeroom' as TimetableMode,
                    label: '学級担任モード',
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

              {/* 教科担任モード: 担当教科設定 */}
              {isSubjectTeacherMode && (
                <div className="space-y-2 pl-1 pt-1">
                  <Label className="text-xs font-medium">担当教科 <span className="text-muted-foreground font-normal">(任意)</span></Label>
                  <p className="text-[10px] text-muted-foreground/70">
                    担当教科を登録するとコマに教科情報を表示できます。1教科の場合は全コマに自動適用されます。
                  </p>

                  {/* 登録済み教科のチップ表示 */}
                  {subjectTeacherSubjects.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 p-2 bg-primary/5 border border-primary/20 rounded-lg">
                      {subjectTeacherSubjects.map(s => (
                        <span
                          key={s.name}
                          className="flex items-center gap-1 text-[11px] rounded-full px-2.5 py-1 font-semibold cursor-pointer hover:opacity-70 transition-opacity"
                          style={{
                            backgroundColor: s.color ? `${s.color}25` : '#f0f0f0',
                            color: s.color ?? '#666',
                            border: `1.5px solid ${s.color ?? '#ccc'}60`,
                          }}
                          title="クリックで削除"
                          onClick={() => removeSubjectTeacherSubject(s.name)}
                        >
                          {s.name} <X size={9} />
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 教科を選択（チップボタン一覧） */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground font-medium">教科を選択:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFAULT_SUBJECTS.filter(s => !subjectTeacherSubjects.some(x => x.name === s.name)).map(s => (
                        <button
                          key={s.name}
                          onClick={() => addSubjectTeacherSubject(s.name)}
                          className="text-[11px] rounded-full px-2.5 py-1 font-medium border transition-all hover:scale-105 hover:shadow-sm"
                          style={{
                            backgroundColor: s.color ? `${s.color}15` : '#f5f5f5',
                            color: s.color ?? '#555',
                            borderColor: s.color ? `${s.color}40` : '#ddd',
                          }}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* リストにない教科を追加（折りたたみ） */}
                  <div className="space-y-1.5">
                    <button
                      onClick={() => setSubjectTeacherInput(prev => prev === null ? "" : (prev === "" ? null as any : ""))}
                      className="text-[11px] text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      <Plus size={10} />
                      <span>リストにない教科を追加</span>
                    </button>
                    <div className="flex gap-2">
                      <Input
                        value={subjectTeacherInput}
                        onChange={e => { setSubjectTeacherInput(e.target.value); setSubjectTeacherError(""); }}
                        onKeyDown={e => e.key === "Enter" && addSubjectTeacherSubject()}
                        placeholder="教科名を入力..."
                        className="h-8 text-xs flex-1"
                      />
                      <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={() => addSubjectTeacherSubject()}>
                        <Plus size={11} />追加
                      </Button>
                    </div>
                    {subjectTeacherError && <p className="text-xs text-red-500">{subjectTeacherError}</p>}
                  </div>

                  {subjectTeacherSubjects.length >= 2 && (
                    <p className="text-[10px] text-primary/70 bg-primary/5 rounded px-2 py-1">
                      ✓ 担当教科が2つ以上のため、複数教科担任として処理されます
                    </p>
                  )}
                </div>
              )}

              {/* Homeroom class selection */}
              {isHomeroomMode && (
                <div className="space-y-1.5 pl-1 pt-1">
                  <Label className="text-xs text-muted-foreground">担任クラス <span className="text-destructive">*</span></Label>
                  <Select value={homeroomClass || "__none__"} onValueChange={v => setHomeroomClass(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="担任クラスを選択..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">— 選択してください —</span>
                      </SelectItem>
                      {allClasses.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!homeroomClass && (
                    <p className="text-xs text-amber-600">担任クラスを選択してください（次へ進むために必要）</p>
                  )}
                </div>
              )}
            </div>

            {/* Class Setup */}
            <div className="space-y-3 border-t border-border/50 pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">クラス構成</Label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">一括設定:</span>
                  {[2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setBulkCount(n)}
                      className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
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
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">学年</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">クラス数</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">生成されるクラス</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: grades }, (_, i) => {
                      const gradeNum = i + 1;
                      const count = gradeClassCounts[i] ?? 3;
                      const classes = Array.from({ length: count }, (_, j) => `${gradeNum}年${j + 1}組`);
                      return (
                        <tr key={gradeNum} className="border-t border-border/50">
                          <td className="px-3 py-2 font-medium">{gradeNum}年生</td>
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
                                <span
                                  key={c}
                                  className={cn(
                                    "text-[10px] rounded px-1.5 py-0.5 font-medium",
                                    isHomeroomMode && c === homeroomClass
                                      ? "bg-amber-100 text-amber-700 ring-1 ring-amber-400"
                                      : "bg-primary/10 text-primary"
                                  )}
                                >
                                  {c}
                                  {isHomeroomMode && c === homeroomClass && " ★"}
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

              {/* Extra custom classes */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">追加クラス（自由記述）</p>
                <div className="flex gap-2">
                  <Input
                    value={customClassInput}
                    onChange={e => {
                      setCustomClassInput(e.target.value);
                      setCustomClassError("");
                    }}
                    onKeyDown={e => e.key === "Enter" && addCustomClass()}
                    placeholder="例: 特別支援学級、英語グループA"
                    className="h-8 text-sm flex-1"
                  />
                  <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={addCustomClass}>
                    <Plus size={11} />
                    追加
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
                <p className="text-xs text-muted-foreground mb-1">作成されるファイル名</p>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  クラス合計: <span className="font-medium text-foreground">{allClasses.length}</span> クラス
                  {isHomeroomMode && homeroomClass && (
                    <span className="ml-2 text-amber-600">/ 担任: <span className="font-medium">{homeroomClass}</span></span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 2: Date Range & Weekend Settings ──────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
              学期の始業式・終業式の日付と、土日授業の有無を設定します。
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">始業式 <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">終業式 <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            {startDate && endDate && startDate > endDate && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
                終業式は始業式より後の日付にしてください
              </div>
            )}

            {startDate && endDate && startDate <= endDate && (() => {
              const start = new Date(startDate + "T00:00:00");
              const end = new Date(endDate + "T00:00:00");
              const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
              const weekdays = Math.floor(days * 5 / 7);
              return (
                <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{days}</span>日間 /
                  平日約<span className="font-medium text-foreground"> {weekdays}</span>日
                  {hasSaturday && <span>・土曜<span className="font-medium text-foreground"> {Math.floor(days / 7)}</span>日</span>}
                </div>
              );
            })()}

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

              <p className="text-xs text-muted-foreground">
                ※ 土日授業をOFFにしても、後から週単位で臨時授業日を追加できます
              </p>
            </div>

            {/* 祝日自動設定 */}
            <div className="space-y-2">
              <p className="text-sm font-medium">祝日の設定</p>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div>
                  <p className="text-sm font-medium">祝日を自動で休校日に設定</p>
                  <p className="text-xs text-muted-foreground">内閣府の祝日データを取得し、学期期間内の祝日を休校日として登録します。後から変更も可能です</p>
                </div>
                <Switch checked={autoSetHolidays} onCheckedChange={setAutoSetHolidays} />
              </div>
              {!autoSetHolidays && (
                <p className="text-xs text-muted-foreground pl-1">
                  ※ 祝日を休校日にしない場合は、作成後に「祝日・休校日の設定」から手動で登録できます
                </p>
              )}
            </div>

            {/* 時程表設定（オプション） */}
            <div className="space-y-2">
              <p className="text-sm font-medium">時程表の設定（オプション）</p>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {wizardPeriodTimes && Object.keys(wizardPeriodTimes).length > 0
                      ? `時程表設定済 — ${Object.keys(wizardPeriodTimes).length}コマ`
                      : "各コマの開始・終了時刻"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    設定するとGoogleカレンダー等へのICS書き出しで正確な時刻が反映されます。後から変更も可能です
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-3 shrink-0 gap-1.5 text-xs"
                  onClick={() => setShowPeriodTimesInWizard(true)}
                >
                  <Clock size={13} />
                  {wizardPeriodTimes && Object.keys(wizardPeriodTimes).length > 0 ? "編集" : "設定する"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* PeriodTimesDialog for wizard */}
        <PeriodTimesDialogStandalone
          open={showPeriodTimesInWizard}
          onOpenChange={setShowPeriodTimesInWizard}
          value={wizardPeriodTimes}
          valueByDay={wizardPeriodTimesByDay}
          hasSaturday={hasSaturday}
          hasSunday={hasSunday}
          onChange={(times, byDay) => {
            setWizardPeriodTimes(times);
            setWizardPeriodTimesByDay(byDay);
          }}
        />

        {/* ─── Step 3: Base Schedule Grid ─────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            {isHomeroomMode ? (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                  <p className="font-semibold mb-1">担任モード — {homeroomClass} の授業コマ設定</p>
                  <p className="text-xs">
                    各コマをクリックして「授業あり（ON）」「授業なし（OFF）」を切り替えます。<br />
                    デフォルトはすべてONです。学年によって5時間目まで、4時間目まで等の違いをここで設定してください。
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="w-12 text-center text-xs text-muted-foreground font-medium py-2 border-b border-border" />
                        {WEEKDAYS.map(d => (
                          <th key={d.key} className="text-center text-xs font-bold py-2 border-b border-border px-1">
                            {d.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PERIODS.map(period => (
                        <tr key={period}>
                          <td className="text-center text-xs text-muted-foreground font-bold py-1 border-b border-border/50 w-12">
                            {period}限
                          </td>
                          {WEEKDAYS.map(d => {
                            const isOn = homeroomSlots[d.key]?.[period] ?? true;
                            const slotOverride = homeroomSlotOverrides[d.key]?.[period] ?? null;
                            const displayClass = slotOverride ?? homeroomClass;
                            const isOverridden = slotOverride !== null && slotOverride !== homeroomClass;
                            return (
                              <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                                {isOn ? (
                                  <div className="flex items-stretch h-10 rounded border-2 border-amber-300 bg-amber-50 overflow-hidden">
                                    {/* クラス名表示ボタン (ON/OFF切り替え) */}
                                    <button
                                      onClick={() => toggleHomeroomSlot(d.key, period)}
                                      className={cn(
                                        "flex-1 text-xs font-semibold transition-all text-amber-700 hover:bg-amber-100 px-1",
                                        isOverridden && "text-blue-700"
                                      )}
                                      title="クリックでOFFに切り替え"
                                    >
                                      {displayClass || "—"}
                                    </button>
                                    {/* ▽クラス変更ドロップダウン */}
                                    <Select
                                      value={slotOverride ?? "__homeroom__"}
                                      onValueChange={v => setHomeroomSlotClass(d.key, period, v === "__homeroom__" ? null : v)}
                                    >
                                      <SelectTrigger className="w-5 h-full border-0 border-l border-amber-200 bg-amber-100 hover:bg-amber-200 rounded-none px-0 focus:ring-0 focus:ring-offset-0 [&>svg:last-child]:hidden">
                                        <ChevronDown size={10} className="text-amber-600 shrink-0" />
                                      </SelectTrigger>
                                      <SelectContent className="max-h-48">
                                        <SelectItem value="__homeroom__" className="text-xs">
                                          <span className="text-amber-700 font-medium">{homeroomClass || "担任クラス"} （担任）</span>
                                        </SelectItem>
                                        {allClasses.filter(c => c !== homeroomClass).map(c => (
                                          <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => toggleHomeroomSlot(d.key, period)}
                                    className="w-full h-10 text-xs rounded border-2 bg-muted/30 border-border/30 text-muted-foreground/40 hover:bg-muted/50 font-semibold transition-all"
                                  >
                                    —
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                  <div><span className="font-medium text-primary">{homeroomOnCount}</span> コマが授業ありに設定されています
                  （週あたり {homeroomOnCount} コマ xd7 学期期間の週数 で自動展開されます）</div>
                  <div className="text-muted-foreground/70">コマ右端の <span className="inline-flex items-center justify-center bg-amber-100 border border-amber-200 rounded w-5 h-5 text-amber-700"><ChevronDown size={10} /></span> をクリックすると、そのコマだけ別のクラスに変更できます。担任クラス以外の授業（学年全体担当など）に対応できます。</div>
                </div>
              </>
            ) : (
              <>
                <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
                  基本時間割を入力します。ここで設定した内容が学期期間の各週に自動展開されます。
                  <span className="block mt-1 text-xs">空欄のままでも作成できます（後から週間グリッドで編集可能）</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="w-12 text-center text-xs text-muted-foreground font-medium py-2 border-b border-border" />
                        {WEEKDAYS.map(d => (
                          <th key={d.key} className="text-center text-xs font-bold py-2 border-b border-border px-1">
                            {d.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PERIODS.map(period => (
                        <tr key={period}>
                          <td className="text-center text-xs text-muted-foreground font-bold py-1 border-b border-border/50 w-12">
                            {period}限
                          </td>
                          {WEEKDAYS.map(d => {
                            const cls = baseSchedule[d.key]?.[period] ?? null;
                            return (
                              <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                                <Select
                                  value={cls ?? "__empty__"}
                                  onValueChange={v => handleClassChange(d.key, period, v === "__empty__" ? null : v)}
                                >
                                  <SelectTrigger className={cn(
                                    "h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0",
                                    cls ? "font-medium" : "text-muted-foreground/50"
                                  )}>
                                    <SelectValue>
                                      <span className={cls ? "font-medium" : "text-muted-foreground/40"}>
                                        {cls ?? "—"}
                                      </span>
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
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {filledCells > 0 && (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
                    <span className="font-medium text-primary">{filledCells}</span> コマの授業が設定されています
                    （週あたり {filledCells} コマ × 学期期間の週数 で自動展開されます）
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ─── Step 4 (subject teacher mode): Subject Schedule Grid ──────── */}
        {step === 4 && isSubjectTeacherMode && (
          <div className="space-y-4">
            {subjectTeacherSubjects.length === 1 ? (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
                  <p className="font-semibold mb-1">教科担任モード — 単数教科自動適用</p>
                  <p className="text-xs">
                    担当教科「<span className="font-bold">{subjectTeacherSubjects[0].name}</span>」が、クラスの設定された全コマに自動適用されます。<br />
                    後から週間グリッドで個別に変更することもできます。
                  </p>
                </div>
                {filledCells > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="w-12 text-center text-xs text-muted-foreground font-medium py-2 border-b border-border" />
                          {WEEKDAYS.map(d => (
                            <th key={d.key} className="text-center text-xs font-bold py-2 border-b border-border px-1">{d.label}</th>
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
                                  <div className={cn(
                                    "h-8 text-xs px-1 flex items-center justify-center rounded font-medium",
                                    cls ? "bg-blue-50 border border-blue-200 text-blue-700" : "bg-muted/20 text-muted-foreground/30"
                                  )}>
                                    {cls ? subjectTeacherSubjects[0].name : "—"}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                    基本時間割（Step 3）でクラスが設定されていないため、教科の自動適用対象コマがありません。戻ってクラスを設定してください。
                  </div>
                )}
              </>
            ) : subjectTeacherSubjects.length >= 2 ? (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
                  <p className="font-semibold mb-1">教科担任モード — 複数教科設定</p>
                  <p className="text-xs">
                    各コマに担当教科を割り当てます。「…年をすべて」ボタンで学年単位の一括設定もできます。
                  </p>
                </div>

                {/* 一括設定ツール */}
                <div className="flex flex-wrap gap-2 p-3 bg-muted/20 rounded-lg border border-border">
                  <span className="text-xs text-muted-foreground font-medium self-center">一括設定:</span>
                  {Array.from(new Set(allClasses.map(c => {
                    const m = c.match(/(\d+)年/);
                    return m ? parseInt(m[1]) : null;
                  }).filter((g): g is number => g !== null))).sort().map(grade => (
                    <div key={grade} className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{grade}年:</span>
                      {subjectTeacherSubjects.map(s => (
                        <button
                          key={s.name}
                          onClick={() => {
                            // n年の全クラスの全コマを指定教科に設定
                            const gradeClasses = allClasses.filter(c => c.startsWith(`${grade}年`));
                            setSubjectSchedule(prev => {
                              const next = { ...prev };
                              WEEKDAYS.forEach(d => {
                                next[d.key] = { ...next[d.key] };
                                PERIODS.forEach(p => {
                                  const cls = baseSchedule[d.key]?.[p];
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
                    onClick={() => setSubjectSchedule(prev => {
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
                        <th className="w-12 text-center text-xs text-muted-foreground font-medium py-2 border-b border-border" />
                        {WEEKDAYS.map(d => (
                          <th key={d.key} className="text-center text-xs font-bold py-2 border-b border-border px-1">{d.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PERIODS.map(period => (
                        <tr key={period}>
                          <td className="text-center text-xs text-muted-foreground font-bold py-1 border-b border-border/50 w-12">{period}限</td>
                          {WEEKDAYS.map(d => {
                            const cls = baseSchedule[d.key]?.[period] ?? null;
                            const subj = subjectSchedule[d.key]?.[period] ?? null;
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
                                  onValueChange={v => handleSubjectChange(d.key, period, v === "__empty__" ? null : v)}
                                >
                                  <SelectTrigger className={cn(
                                    "h-8 text-xs border focus:ring-0 focus:ring-offset-0",
                                    subj ? "font-semibold bg-blue-50 border-blue-200 text-blue-800" : "bg-transparent border-border/50 text-muted-foreground/50"
                                  )}>
                                    <SelectValue>
                                      <span className={subj ? "font-semibold" : "text-muted-foreground/40"}>
                                        {subj ?? cls}
                                      </span>
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent className="max-h-48">
                                    <SelectItem value="__empty__">
                                      <span className="text-muted-foreground">— 未設定 —</span>
                                    </SelectItem>
                                    {subjectTeacherSubjects.map(s => (
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

                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-primary">{subjectFilledCount}</span> コマに教科が設定されています
                  {filledCells > 0 && subjectFilledCount < filledCells && (
                    <span className="ml-2 text-amber-600">（残り {filledCells - subjectFilledCount} コマは未設定）</span>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                <p className="font-semibold">担当教科が未登録です</p>
                <p className="text-xs mt-1">戻ってStep 1の「担当教科」で教科を登録してください。登録しなくても作成できますが、教科情報は空になります。</p>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 4 (homeroom only): Subject Schedule ──────────────────── */}
        {step === 4 && isHomeroomMode && (        <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
              <p className="font-semibold mb-1">教科の基礎時間割を設定（任意）</p>
              <p className="text-xs">
                授業ありのコマに教科を割り当てます。ここで設定した教科が学期全体の基礎時間割として適用されます。<br />
                設定しなくても作成できます（後から週間グリッドで個別に設定可能）。
              </p>
            </div>

            {/* Subject list management */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">使用する教科リスト</Label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{subjects.length}教科</span>
                  {subjects.length < DEFAULT_SUBJECTS.length && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 gap-1"
                      onClick={addAllDefaultSubjects}
                    >
                      <Plus size={9} />
                      デフォルト教科を全て追加
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 p-2 border border-border rounded-lg bg-muted/20 min-h-[40px]">
                {subjects.map(s => (
                  <span
                    key={s.name}
                    className="flex items-center gap-1 text-[11px] rounded px-2 py-0.5 font-medium cursor-pointer transition-colors"
                    style={{
                      backgroundColor: s.color ? `${s.color}20` : '#f0f0f0',
                      color: s.color ?? '#666',
                      border: `1px solid ${s.color ?? '#ccc'}50`,
                    }}
                    title="クリックで削除"
                    onClick={() => removeSubject(s.name)}
                  >
                    {s.name}
                    <X size={9} />
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newSubjectInput}
                  onChange={e => {
                    setNewSubjectInput(e.target.value);
                    setNewSubjectError("");
                  }}
                  onKeyDown={e => e.key === "Enter" && addSubject()}
                  placeholder="教科名を追加（例: 外国語、総合学習）"
                  className="h-8 text-sm flex-1"
                />
                <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={() => addSubject()}>
                  <Plus size={11} />
                  追加
                </Button>
              </div>
              {newSubjectError && <p className="text-xs text-red-500">{newSubjectError}</p>}
            </div>

            {/* Subject schedule grid */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-12 text-center text-xs text-muted-foreground font-medium py-2 border-b border-border" />
                    {WEEKDAYS.map(d => (
                      <th key={d.key} className="text-center text-xs font-bold py-2 border-b border-border px-1">
                        {d.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERIODS.map(period => (
                    <tr key={period}>
                      <td className="text-center text-xs text-muted-foreground font-bold py-1 border-b border-border/50 w-12">
                        {period}限
                      </td>
                      {WEEKDAYS.map(d => {
                        const isOn = homeroomSlots[d.key]?.[period] ?? true;
                        const subj = subjectSchedule[d.key]?.[period] ?? null;
                        const subjColor = subj ? (subjects.find(s => s.name === subj)?.color ?? null) : null;
                        if (!isOn) {
                          return (
                            <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                              <div className="h-8 text-xs px-1 flex items-center justify-center rounded bg-muted/20 text-muted-foreground/30">
                                —
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                            {addingSubjectForCell?.weekday === d.key && addingSubjectForCell?.period === period ? (
                              <div className="flex flex-col gap-1 p-1">
                                <Input
                                  autoFocus
                                  value={inlineSubjectInput}
                                  onChange={e => setInlineSubjectInput(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') addInlineSubject(d.key, period);
                                    if (e.key === 'Escape') { setAddingSubjectForCell(null); setInlineSubjectInput(''); }
                                  }}
                                  placeholder="教科名"
                                  className="h-7 text-xs"
                                />
                                <div className="flex gap-1">
                                  <Button size="sm" className="h-6 px-2 text-[10px] flex-1" onClick={() => addInlineSubject(d.key, period)}>
                                    <Plus size={9} /> 追加
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() => { setAddingSubjectForCell(null); setInlineSubjectInput(''); }}
                                  >
                                    <X size={9} />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                            <Select
                              value={subj ?? "__empty__"}
                              onValueChange={v => {
                                if (v === '__add_new__') {
                                  setAddingSubjectForCell({ weekday: d.key, period });
                                  setInlineSubjectInput('');
                                } else {
                                  handleSubjectChange(d.key, period, v === "__empty__" ? null : v);
                                }
                              }}
                            >
                              <SelectTrigger
                                className={cn(
                                  "h-8 text-xs border focus:ring-0 focus:ring-offset-0",
                                  subj ? "font-semibold" : "bg-transparent border-border/50 text-muted-foreground/50"
                                )}
                                style={subjColor ? {
                                  backgroundColor: `${subjColor}18`,
                                  borderColor: `${subjColor}60`,
                                  color: subjColor,
                                } : undefined}
                              >
                                <SelectValue>
                                  <span className={subj ? "font-semibold" : "text-muted-foreground/40"} style={subjColor ? { color: subjColor } : undefined}>
                                    {subj ?? "—"}
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
                                <SelectItem value="__add_new__" className="text-xs text-primary">
                                  <span className="flex items-center gap-1">
                                    <Plus size={10} />
                                    教科を追加...
                                  </span>
                                </SelectItem>
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

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
              <span className="font-medium text-primary">{subjectFilledCount}</span> コマに教科が設定されています
              {subjectFilledCount < homeroomOnCount && (
                <span className="ml-2 text-amber-600">（残り {homeroomOnCount - subjectFilledCount} コマは未設定）</span>
              )}
            </div>
          </div>
        )}

        {/* ─── Confirmation Step ──────────────────────────────── */}
        {step === confirmStep && (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
              以下の内容で時間割を作成します。確認してください。
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">ファイル名</p>
                  <p className="text-sm font-semibold">{title}</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">学校名</p>
                  <p className="text-sm font-semibold">{school || "（未設定）"}</p>
                </div>
              </div>

              {/* Mode summary */}
              <div className="bg-card border border-border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">使用モード</p>
                <p className="text-sm font-semibold">
                  {isSubjectTeacherMode && (
                    subjectTeacherSubjects.length === 1
                      ? `教科担任モード（単数教科） — 担当: ${subjectTeacherSubjects[0].name}`
                      : subjectTeacherSubjects.length >= 2
                      ? `教科担任モード（複数教科） — 担当: ${subjectTeacherSubjects.map(s => s.name).join('・')}`
                      : '教科担任モード'
                  )}
                  {isHomeroomMode && `学級担任モード${homeroomClass ? ` — 担任クラス: ${homeroomClass}` : ''}`}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">始業式</p>
                  <p className="text-sm font-semibold">{startDate}</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">終業式</p>
                  <p className="text-sm font-semibold">{endDate}</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">週末授業</p>
                  <p className="text-sm font-semibold">
                    {hasSaturday && hasSunday ? "土・日" :
                     hasSaturday ? "土曜のみ" :
                     hasSunday ? "日曜のみ" : "なし"}
                  </p>
                </div>
              </div>

              {/* Class list summary */}
              <div className="bg-card border border-border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  クラス構成 — {schoolTypeInfo.label}、合計 {allClasses.length} クラス
                </p>
                <div className="flex flex-wrap gap-1">
                  {allClasses.map(c => (
                    <span
                      key={c}
                      className={cn(
                        "text-[10px] rounded px-1.5 py-0.5 font-medium",
                        isHomeroomMode && c === homeroomClass
                          ? "bg-amber-100 text-amber-700 ring-1 ring-amber-400"
                          : "bg-primary/10 text-primary"
                      )}
                    >
                      {c}
                      {isHomeroomMode && c === homeroomClass && " ★"}
                    </span>
                  ))}
                </div>
              </div>

              {/* Homeroom schedule summary */}
              {isHomeroomMode && (
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    授業コマ設定 — 週{homeroomOnCount}コマ
                    {subjectFilledCount > 0 && <span className="ml-1 text-amber-600">（教科設定: {subjectFilledCount}コマ）</span>}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="w-8 text-muted-foreground font-normal border-b border-border pb-1" />
                          {WEEKDAYS.map(d => (
                            <th key={d.key} className="text-center font-bold px-2 pb-1 border-b border-border">{d.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PERIODS.map(p => (
                          <tr key={p}>
                            <td className="text-muted-foreground text-center py-0.5 pr-1">{p}</td>
                            {WEEKDAYS.map(d => {
                              const isOn = homeroomSlots[d.key]?.[p] ?? true;
                              const subj = subjectSchedule[d.key]?.[p] ?? null;
                              const slotOverride = homeroomSlotOverrides[d.key]?.[p] ?? null;
                              const displayClass = slotOverride !== null ? slotOverride : homeroomClass;
                              const isOverridden = slotOverride !== null && slotOverride !== homeroomClass;
                              return (
                                <td key={d.key} className="text-center px-1 py-0.5">
                                  {isOn ? (
                                    subj ? (
                                      <span className="font-semibold text-amber-700">{subj}</span>
                                    ) : (
                                      <span className={cn(
                                        "text-[9px]",
                                        isOverridden ? "text-blue-600 font-semibold" : "text-amber-500/60"
                                      )}>{displayClass}</span>
                                    )
                                  ) : (
                                    <span className="text-muted-foreground/30">—</span>
                                  )}
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

              {/* Subject teacher subjects summary (confirmation step) */}
              {isSubjectTeacherMode && subjectTeacherSubjects.length > 0 && (
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-2">担当教科</p>
                  <div className="flex flex-wrap gap-1">
                    {subjectTeacherSubjects.map(s => (
                      <span
                        key={s.name}
                        className="text-[10px] rounded px-1.5 py-0.5 font-medium"
                        style={{
                          backgroundColor: s.color ? `${s.color}20` : '#f0f0f0',
                          color: s.color ?? '#666',
                          border: `1px solid ${s.color ?? '#ccc'}50`,
                        }}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Single subject schedule summary */}
              {!isHomeroomMode && (
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-2">基本時間割</p>
                  {filledCells > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="text-xs border-collapse">
                        <thead>
                          <tr>
                            <th className="w-8 text-muted-foreground font-normal border-b border-border pb-1" />
                            {WEEKDAYS.map(d => (
                              <th key={d.key} className="text-center font-bold px-2 pb-1 border-b border-border">{d.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {PERIODS.map(p => (
                            <tr key={p}>
                              <td className="text-muted-foreground text-center py-0.5 pr-1">{p}</td>
                              {WEEKDAYS.map(d => {
                                const cls = baseSchedule[d.key]?.[p];
                                return (
                                  <td key={d.key} className="text-center px-2 py-0.5">
                                    {cls ? (
                                      <span className="font-medium text-foreground">{cls}</span>
                                    ) : (
                                      <span className="text-muted-foreground/30">—</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60">基本時間割は設定されていません（空きコマで作成）</p>
                  )}
                </div>
              )}

              {/* 時程表設定状況 */}
              {wizardPeriodTimes && Object.keys(wizardPeriodTimes).length > 0 && (
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">時程表</p>
                  <div className="flex flex-wrap gap-2">
                    {PERIODS.map(p => {
                      const t = wizardPeriodTimes[p];
                      if (!t?.start || !t?.end) return null;
                      return (
                        <div key={p} className="flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded px-2 py-1">
                          <span className="font-bold text-blue-700 dark:text-blue-400">{p}限</span>
                          <span className="text-muted-foreground">{t.start}〜{t.end}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {startDate && endDate && startDate <= endDate && (() => {
                const start = new Date(startDate + "T00:00:00");
                const end = new Date(endDate + "T00:00:00");
                const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                const weekdays = Math.floor(days * 5 / 7);
                const totalPeriods = isHomeroomMode
                  ? homeroomOnCount * Math.floor(days / 7)
                  : filledCells * Math.floor(days / 7);
                return (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{days}</span>日間 /
                    平日約<span className="font-medium text-foreground"> {weekdays}</span>日 /
                    総コマ数（予定）<span className="font-medium text-primary"> {totalPeriods}</span>コマ
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ─── Navigation Buttons ─────────────────────────────── */}
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
            <span className="text-xs text-muted-foreground">{step} / {totalSteps}</span>
            {step < confirmStep ? (
              <Button
                size="sm"
                onClick={() => setStep(s => s + 1)}
                disabled={!canGoNext()}
                className="gap-1.5"
              >
                次へ
                <ChevronRight size={14} />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={loading}
                className="gap-1.5"
              >
                <FilePlus size={13} />
                {loading ? "作成中..." : "作成する"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
