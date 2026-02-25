// NewFileWizard.tsx
// Design: Swiss Grid × Japanese Functional Design
// 4-step wizard for creating a new timetable (semester unit)
// Step 1: School/year/semester metadata
// Step 2: Saturday/Sunday class settings
// Step 3: Base schedule grid (weekday × period → class)
// Step 4: Confirmation and creation

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
import { generateBaseEntries, createNewTimetableFile, SemesterMeta } from "@/lib/timetableFile";
import { useTimetable } from "@/contexts/TimetableContext";
import { VALID_CLASSES } from "@/lib/timetable";
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

export type SemesterSystem = "trimester" | "semester";

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

  // Step 2: Date range & weekend settings
  const [startDate, setStartDate] = useState(() => getSemesterDefaults(academicYear, 1).start);
  const [endDate, setEndDate] = useState(() => getSemesterDefaults(academicYear, 1).end);
  const [hasSaturday, setHasSaturday] = useState(false);
  const [hasSunday, setHasSunday] = useState(false);

  // Step 3: Base schedule
  // baseSchedule[weekday][period] = class | null
  const [baseSchedule, setBaseSchedule] = useState<Record<string, Record<number, string | null>>>(() => {
    const schedule: Record<string, Record<number, string | null>> = {};
    WEEKDAYS.forEach(d => {
      schedule[d.key] = {};
      PERIODS.forEach(p => { schedule[d.key][p] = null; });
    });
    return schedule;
  });

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
    : `第${semesterNumber}学期`;
  const title = `${academicYear}年度 ${semesterLabel}${school ? ` (${school})` : ""}`;

  const handleCreate = async () => {
    setLoading(true);
    try {
      // Build base entries with schedule
      const base = generateBaseEntries(startDate, endDate, {
        hasSaturday,
        hasSunday,
        baseSchedule,
      });

      const file = createNewTimetableFile(title, school || undefined, `${academicYear}年度`);

      const semester: SemesterMeta = {
        semesterNumber,
        semesterSystem,
        startDate,
        endDate,
        hasSaturday,
        hasSunday,
        baseSchedule,
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
    if (step === 1) return true; // school is optional
    if (step === 2) return startDate && endDate && startDate <= endDate;
    if (step === 3) return true; // base schedule is optional
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

        {/* ─── Step 1: School Info ─────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
              学校名・年度・学期を設定します。これらは後から変更できます。
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
              <Label className="text-sm font-medium">学期制 <span className="text-destructive">*</span></Label>
              <Select value={semesterSystem} onValueChange={v => handleSemesterSystemChange(v as SemesterSystem)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trimester">3学期制（前期・中期・後期）</SelectItem>
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
                        <SelectItem value="1">第1学期（4月〜7月）</SelectItem>
                        <SelectItem value="2">第2学期（9月〜12月）</SelectItem>
                        <SelectItem value="3">第3学期（1月〜3月）</SelectItem>
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

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">作成されるファイル名</p>
              <p className="text-sm font-semibold text-foreground">{title}</p>
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
                <Switch
                  checked={hasSaturday}
                  onCheckedChange={setHasSaturday}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div>
                  <p className="text-sm font-medium">日曜授業</p>
                  <p className="text-xs text-muted-foreground">毎週日曜日を授業日として追加</p>
                </div>
                <Switch
                  checked={hasSunday}
                  onCheckedChange={setHasSunday}
                />
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
                                {["1年", "2年", "3年", "4年", "5年", "6年"].map(grade => {
                                  const gradeClasses = VALID_CLASSES.filter(c => c.startsWith(grade));
                                  return gradeClasses.map(c => (
                                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                                  ));
                                })}
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

              {startDate && endDate && startDate <= endDate && (() => {
                const start = new Date(startDate + "T00:00:00");
                const end = new Date(endDate + "T00:00:00");
                const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                const weekdays = Math.floor(days * 5 / 7);
                const totalPeriods = filledCells * Math.floor(days / 7);
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
