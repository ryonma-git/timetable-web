// SettingsDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// Settings dialog: edit semester meta, base schedule, custom classes after creation

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
  X,
  AlertTriangle,
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
import { SemesterMeta, SemesterSystem } from "@/lib/timetableFile";
import { useTimetable } from "@/contexts/TimetableContext";
import { VALID_CLASSES } from "@/lib/timetable";
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

// Compute default academic year from current date
function getDefaultAcademicYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
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

// Semester defaults
function getSemesterDefaults(year: number, semester: 1 | 2 | 3, system: SemesterSystem) {
  if (system === "semester") {
    switch (semester) {
      case 1: return { start: `${year}-04-01`, end: `${year}-09-30` };
      case 2: return { start: `${year}-10-01`, end: `${year + 1}-03-31` };
      default: return { start: `${year}-04-01`, end: `${year}-09-30` };
    }
  }
  // trimester
  switch (semester) {
    case 1: return { start: `${year}-04-01`, end: `${year}-07-20` };
    case 2: return { start: `${year}-09-01`, end: `${year}-12-25` };
    case 3: return { start: `${year + 1}-01-08`, end: `${year + 1}-03-25` };
  }
}

// Step indicator
function StepIndicator({ current, total }: { current: number; total: number }) {
  const steps = [
    { icon: <School size={14} />, label: "基本情報" },
    { icon: <Calendar size={14} />, label: "授業日設定" },
    { icon: <Grid3X3 size={14} />, label: "基本時間割" },
    { icon: <Check size={14} />, label: "確認・適用" },
  ];
  return (
    <div className="flex items-center gap-0 mb-5">
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
  const { currentFile, semester, customClasses, updateSettings, isLoaded } = useTimetable();
  const [step, setStep] = useState(1);

  // ── Step 1: Basic info ──────────────────────────────────────
  const [school, setSchool] = useState("");
  const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
  const [semesterSystem, setSemesterSystem] = useState<SemesterSystem>("trimester");
  const [semesterNumber, setSemesterNumber] = useState<1 | 2 | 3>(1);

  // ── Step 2: Date & weekend ──────────────────────────────────
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasSaturday, setHasSaturday] = useState(false);
  const [hasSunday, setHasSunday] = useState(false);

  // ── Step 3: Base schedule ───────────────────────────────────
  const [baseSchedule, setBaseSchedule] = useState<Record<string, Record<number, string | null>>>(() => {
    const s: Record<string, Record<number, string | null>> = {};
    WEEKDAYS.forEach(d => { s[d.key] = {}; PERIODS.forEach(p => { s[d.key][p] = null; }); });
    return s;
  });
  const [localCustomClasses, setLocalCustomClasses] = useState<string[]>([]);
  const [newClassInput, setNewClassInput] = useState("");

  // ── Step 4: Apply mode ──────────────────────────────────────
  const [applyMode, setApplyMode] = useState<"all" | "from">("all");
  const [applyFromDate, setApplyFromDate] = useState("");

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
      // Populate base schedule
      const s: Record<string, Record<number, string | null>> = {};
      WEEKDAYS.forEach(d => {
        s[d.key] = {};
        PERIODS.forEach(p => { s[d.key][p] = semester.baseSchedule?.[d.key]?.[p] ?? null; });
      });
      setBaseSchedule(s);
      setLocalCustomClasses(semester.customClasses ?? []);
      setStep(1);
      setApplyMode("all");
      setApplyFromDate(semester.startDate);
    }
  }, [open, semester, currentFile]);

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

  const handleAddCustomClass = () => {
    const trimmed = newClassInput.trim();
    if (!trimmed) return;
    if (localCustomClasses.includes(trimmed) || VALID_CLASSES.includes(trimmed)) {
      toast.error("同じクラス名が既に存在します");
      return;
    }
    setLocalCustomClasses(prev => [...prev, trimmed]);
    setNewClassInput("");
  };

  const handleRemoveCustomClass = (cls: string) => {
    setLocalCustomClasses(prev => prev.filter(c => c !== cls));
  };

  const allClasses = [...VALID_CLASSES, ...localCustomClasses];

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
    return true;
  };

  const handleApply = () => {
    const newSemester: SemesterMeta = {
      semesterNumber,
      semesterSystem,
      startDate,
      endDate,
      hasSaturday,
      hasSunday,
      baseSchedule,
      customClasses: localCustomClasses.length > 0 ? localCustomClasses : undefined,
    };
    const from = applyMode === "from" ? applyFromDate : undefined;
    updateSettings(newSemester, from);
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

        <StepIndicator current={step} total={4} />

        {/* ─── Step 1: Basic Info ──────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
              学校名・学期制・年度・学期番号を変更できます。
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

            {/* Custom classes */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">カスタムクラス <span className="text-muted-foreground font-normal text-xs">(標準クラス以外に追加)</span></Label>
              <div className="flex gap-2">
                <Input
                  value={newClassInput}
                  onChange={e => setNewClassInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddCustomClass()}
                  placeholder="例: 特支1組、TF-A など"
                  className="h-8 text-sm flex-1"
                />
                <Button size="sm" variant="outline" onClick={handleAddCustomClass} className="h-8 gap-1">
                  <Plus size={13} />追加
                </Button>
              </div>
              {localCustomClasses.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {localCustomClasses.map(cls => (
                    <span key={cls} className="inline-flex items-center gap-1 bg-primary/10 text-primary rounded px-2 py-0.5 text-xs font-medium border border-primary/20">
                      {cls}
                      <button onClick={() => handleRemoveCustomClass(cls)} className="hover:text-destructive transition-colors">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">変更後のタイトル</p>
              <p className="text-sm font-semibold text-foreground">{title}</p>
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

        {/* ─── Step 3: Base Schedule ───────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
              基本時間割を変更します。変更の適用範囲は次のステップで選べます。
            </div>

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
                                {["1年", "2年", "3年", "4年", "5年", "6年"].map(grade => {
                                  const gradeClasses = allClasses.filter(c => c.startsWith(grade));
                                  return gradeClasses.map(c => (
                                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                                  ));
                                })}
                                {localCustomClasses.filter(c => !["1年", "2年", "3年", "4年", "5年", "6年"].some(g => c.startsWith(g))).map(c => (
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
              </div>
            )}
          </div>
        )}

        {/* ─── Step 4: Apply Mode ──────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
              変更の適用範囲を選択してください。
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
                  "w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center",
                  applyMode === "all" ? "border-primary bg-primary" : "border-muted-foreground"
                )}>
                  {applyMode === "all" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold">学期全体に適用</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {startDate} 〜 {endDate} の全期間のbaseデータを再生成します。
                    既存の個別変更（ops）はそのまま保持されます。
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
                  "w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center",
                  applyMode === "from" ? "border-primary bg-primary" : "border-muted-foreground"
                )}>
                  {applyMode === "from" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
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
            <span className="text-xs text-muted-foreground">{step} / 4</span>
            {step < 4 ? (
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
