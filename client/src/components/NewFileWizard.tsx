// Design: Swiss Grid × Japanese Functional Design
// 4-step wizard for creating a new timetable (semester unit)
// Step 1: School/year/semester metadata + school type + class setup + mode selection
// Step 2: Saturday/Sunday class settings
// Step 3: Base schedule grid (weekday × period → class)
// Step 4: Confirmation and creation
// Phase 4: モード選択・担任クラス設定を追加

import { useState, useCallback } from "react";
import {
  FilePlus,
  ChevronRight,
  ChevronLeft,
  Check,
  School,
  Calendar,
  CalendarDays,
  Grid3X3,
  Plus,
  Minus,
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
import { generateBaseEntries, createNewTimetableFile, SemesterMeta, TimetableMode, SemesterSystem } from "@/lib/timetableFile";
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
function StepIndicator({ current, total }: { current: number; total: number }) {
  const steps = [
    { icon: <School size={14} />, label: "学校情報" },
    { icon: <Calendar size={14} />, label: "授業日設定" },
    { icon: <Grid3X3 size={14} />, label: "基本時間割" },
    { icon: <Check size={14} />, label: "確認・作成" },
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
                "h-0.5 w-8 mx-1 mb-4 transition-all",
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
  const { loadTimetableFile } = useTimetable();
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

  // Step 2: Date range & weekend settings
  const [startDate, setStartDate] = useState(() => getSemesterDefaults(academicYear, 1).start);
  const [endDate, setEndDate] = useState(() => getSemesterDefaults(academicYear, 1).end);
  const [hasSaturday, setHasSaturday] = useState(false);
  const [hasSunday, setHasSunday] = useState(false);

  // Step 3: Base schedule
  const [baseSchedule, setBaseSchedule] = useState<Record<string, Record<number, string | null>>>(() => {
    const schedule: Record<string, Record<number, string | null>> = {};
    WEEKDAYS.forEach(d => {
      schedule[d.key] = {};
      PERIODS.forEach(p => { schedule[d.key][p] = null; });
    });
    return schedule;
  });

  // Derived: current school type info
  const schoolTypeInfo = SCHOOL_TYPES.find(s => s.value === schoolType) ?? SCHOOL_TYPES[0];
  const grades = schoolTypeInfo.grades;

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

  // Count filled cells
  const filledCells = Object.values(baseSchedule).reduce((sum, day) =>
    sum + Object.values(day).filter(c => c !== null).length, 0
  );

  // Title derived from inputs
  const semesterLabel = semesterSystem === "semester"
    ? (semesterNumber === 1 ? "前期" : "後期")
    : `${semesterNumber}学期`;
  const title = `${academicYear}年度 ${semesterLabel}${school ? ` (${school})` : ""}`;

  const handleCreate = async () => {
    setLoading(true);
    try {
      // For homeroom mode: fill base schedule with homeroomClass
      let effectiveBaseSchedule = baseSchedule;
      if (selectedMode === 'homeroom' && homeroomClass) {
        const schedule: Record<string, Record<number, string | null>> = {};
        WEEKDAYS.forEach(d => {
          schedule[d.key] = {};
          PERIODS.forEach(p => { schedule[d.key][p] = homeroomClass; });
        });
        effectiveBaseSchedule = schedule;
      }

      const base = generateBaseEntries(startDate, endDate, {
        hasSaturday,
        hasSunday,
        baseSchedule: effectiveBaseSchedule,
      });

      const file = createNewTimetableFile(title, school || undefined, `${academicYear}年度`);

      // Set mode on meta
      file.meta.mode = selectedMode;

      const semester: SemesterMeta = {
        semesterNumber,
        semesterSystem,
        startDate,
        endDate,
        hasSaturday,
        hasSunday,
        baseSchedule: effectiveBaseSchedule,
        schoolType,
        gradeClassCounts: gradeClassCounts.slice(0, grades),
        classList: allClasses,
        customClasses: extraClasses,
        homeroomClass: selectedMode === 'homeroom' ? (homeroomClass || undefined) : undefined,
      };
      file.semester = semester;
      file.base = base;

      await loadTimetableFile(file);
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
      // homeroom mode requires a class to be selected
      if (selectedMode === 'homeroom' && !homeroomClass) return false;
      return true;
    }
    if (step === 2) return startDate && endDate && startDate <= endDate;
    if (step === 3) return true;
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

        <StepIndicator current={step} total={4} />

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
                                    selectedMode === 'homeroom' && c === homeroomClass
                                      ? "bg-amber-100 text-amber-700 ring-1 ring-amber-400"
                                      : "bg-primary/10 text-primary"
                                  )}
                                >
                                  {c}
                                  {selectedMode === 'homeroom' && c === homeroomClass && " ★"}
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
                  {selectedMode === 'homeroom' && homeroomClass && (
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
          </div>
        )}

        {/* ─── Step 3: Base Schedule Grid ─────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            {selectedMode === 'homeroom' ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                <p className="font-semibold mb-1">担任モード — {homeroomClass}</p>
                <p className="text-xs">
                  担任モードでは、基本時間割のすべてのコマに担任クラス（{homeroomClass}）が自動設定されます。
                  教科は週間グリッドの各コマから個別に設定できます。
                </p>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
                基本時間割を入力します。ここで設定した内容が学期期間の各週に自動展開されます。
                <span className="block mt-1 text-xs">空欄のままでも作成できます（後から週間グリッドで編集可能）</span>
              </div>
            )}

            {selectedMode !== 'homeroom' && (
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
            )}

            {selectedMode === 'homeroom' && (
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
                        {WEEKDAYS.map(d => (
                          <td key={d.key} className="p-0.5 border-b border-r border-border/30">
                            <div className="h-8 text-xs px-2 flex items-center rounded bg-amber-50 text-amber-700 font-medium">
                              {homeroomClass}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedMode !== 'homeroom' && filledCells > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
                <span className="font-medium text-primary">{filledCells}</span> コマの授業が設定されています
                （週あたり {filledCells} コマ × 学期期間の週数 で自動展開されます）
              </div>
            )}
          </div>
        )}

        {/* ─── Step 4: Confirmation ───────────────────────────── */}
        {step === 4 && (
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
                  {selectedMode === 'single_subject' && '教科担任モード（従来）'}
                  {selectedMode === 'homeroom' && `担任モード${homeroomClass ? ` — 担任クラス: ${homeroomClass}` : ''}`}
                  {selectedMode === 'multi_subject' && '複数教科モード'}
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
                        selectedMode === 'homeroom' && c === homeroomClass
                          ? "bg-amber-100 text-amber-700 ring-1 ring-amber-400"
                          : "bg-primary/10 text-primary"
                      )}
                    >
                      {c}
                      {selectedMode === 'homeroom' && c === homeroomClass && " ★"}
                    </span>
                  ))}
                </div>
              </div>

              {selectedMode !== 'homeroom' && (
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

              {startDate && endDate && startDate <= endDate && (() => {
                const start = new Date(startDate + "T00:00:00");
                const end = new Date(endDate + "T00:00:00");
                const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                const weekdays = Math.floor(days * 5 / 7);
                const totalPeriods = selectedMode === 'homeroom'
                  ? PERIODS.length * WEEKDAYS.length * Math.floor(days / 7)
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
            <span className="text-xs text-muted-foreground">{step} / 4</span>
            {step < 4 ? (
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
