// StatsView.tsx
// Design: Swiss Grid × Japanese Functional Design
// Stats, history, and audit log views
// 年間集計: 複数学期データを横断してクラス別累計授業数・残り時数を表示

import { useMemo, useState } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { useLanguage, type Language } from "@/contexts/LanguageContext";
import type { SemesterMeta } from "@/lib/timetableFile";
import { ClassStats, SubjectStats, todayISO, applyOverrides, calcClassStats, classSort } from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Info, BarChart3, CalendarRange, Download, BookOpen } from "lucide-react";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { getClassColor, getSubjectColor } from "@/lib/gradeColors";
import { exportAnnualStatsCSV, exportAnnualStatsExcel, type AnnualClassStat } from "@/lib/exportUtils";

function formatItemCount(count: number, language: Language) {
  return language === "ja" ? `${count}件` : `${count} ${count === 1 ? "item" : "items"}`;
}

function formatOperationCount(count: number, language: Language) {
  return language === "ja" ? `${count}件の操作` : `${count} ${count === 1 ? "operation" : "operations"}`;
}

function formatPeriodUnit(language: Language, unit: string) {
  return language === "ja" ? unit : ` ${unit}`;
}

// ─── Stats View ───────────────────────────────────────────────

const ALL_SUBJECTS = "__all__";

export function StatsView() {
  const { classStats, subjectStats, statsEntries, asOfDate, setAsOfDate, isLoaded, currentFile, mode } = useTimetable();
  const { t } = useLanguage();
  // 学級担任モードは教科集計をデフォルトに表示、教科担任モードはクラス集計をデフォルトに表示
  const defaultStatsTab = mode === 'homeroom' ? 'subject' : 'class';
  const [viewMode, setViewMode] = useState<"semester" | "annual">("semester");
  const [statsTab, setStatsTab] = useState<"class" | "subject">(defaultStatsTab);
  // v103: クラス別集計の教科フィルタ（"その他"等の混入を排除）
  const [subjectFilter, setSubjectFilter] = useState<string>(ALL_SUBJECTS);

  // 利用可能な教科一覧（subjectStatsから、空教科は除外）
  const subjectOptions = useMemo(
    () => subjectStats.map(s => s.subject).filter(Boolean).sort((a, b) => a.localeCompare(b, "ja")),
    [subjectStats]
  );

  // 教科フィルタ適用後のクラス別集計
  const filteredClassStats = useMemo(() => {
    if (subjectFilter === ALL_SUBJECTS) return classStats;
    return calcClassStats(statsEntries, asOfDate, subjectFilter);
  }, [subjectFilter, classStats, statsEntries, asOfDate]);

  if (!isLoaded) {
    return <EmptyState message={t("stats.emptyStats")} />;
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* View mode tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        <button
          onClick={() => setViewMode("semester")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
            viewMode === "semester"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <BarChart3 size={13} />
          {t("stats.semesterStats")}
        </button>
        {(currentFile?.semesters && currentFile.semesters.length > 1) && (
          <button
            onClick={() => setViewMode("annual")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
              viewMode === "annual"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarRange size={13} />
            {t("stats.annualStats")}
          </button>
        )}
      </div>

      {viewMode === "semester" && (
        <>
          {/* Class / Subject tab switcher */}
          <div className="flex items-center gap-1 mb-4">
            <button
              onClick={() => setStatsTab("class")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors border",
                statsTab === "class"
                  ? "bg-sky-50 border-sky-300 text-sky-700"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart3 size={12} />
              {t("stats.classStats")}
            </button>
            {subjectStats.length > 0 && (
              <button
                onClick={() => setStatsTab("subject")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors border",
                  statsTab === "subject"
                    ? "bg-violet-50 border-violet-300 text-violet-700"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <BookOpen size={12} />
                {t("stats.subjectStats")}
              </button>
            )}
          </div>
          {/* v103: クラス別集計の教科フィルタ */}
          {statsTab === "class" && subjectOptions.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">{t("stats.filterBySubject")}</Label>
              <select
                value={subjectFilter}
                onChange={e => setSubjectFilter(e.target.value)}
                className="h-8 text-sm border border-border rounded-md px-2 bg-background min-w-[140px]"
              >
                <option value={ALL_SUBJECTS}>{t("stats.allSubjects")}</option>
                {subjectOptions.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {subjectFilter !== ALL_SUBJECTS && (
                <span className="text-[11px] text-violet-600 bg-violet-50 dark:bg-violet-950/30 rounded px-2 py-0.5">
                  {t("stats.onlySubjectBadge").split("{s}").join(subjectFilter)}
                </span>
              )}
            </div>
          )}
          {statsTab === "class" && (
            <SemesterStatsView classStats={filteredClassStats} asOfDate={asOfDate} setAsOfDate={setAsOfDate} />
          )}
          {statsTab === "subject" && (
            <SubjectStatsView subjectStats={subjectStats} asOfDate={asOfDate} setAsOfDate={setAsOfDate} />
          )}
        </>
      )}
      {viewMode === "annual" && (
        <AnnualStatsView />
      )}
    </div>
  );
}

// ─── Semester Stats (current semester) ───────────────────────

function SemesterStatsView({
  classStats,
  asOfDate,
  setAsOfDate,
}: {
  classStats: ClassStats[];
  asOfDate: string;
  setAsOfDate: (d: string) => void;
}) {
  const { t } = useLanguage();
  const gradeGroups: Record<string, ClassStats[]> = {};
  for (const s of classStats) {
    if (!gradeGroups[s.grade]) gradeGroups[s.grade] = [];
    gradeGroups[s.grade].push(s);
  }

  return (
    <>
      {/* as_of date picker */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">{t("stats.asOfDate")}</Label>
          <Input
            type="date"
            value={asOfDate}
            onChange={e => setAsOfDate(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>
        <button
          onClick={() => setAsOfDate(todayISO())}
          className="text-xs text-primary hover:underline"
        >
          {t("stats.backToToday")}
        </button>
        <span className="text-xs text-muted-foreground">
          {t("stats.asOfHelp")}
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          {
            label: t("stats.totalPeriods"),
            value: classStats.reduce((s, c) => s + c.totalPeriods, 0),
            color: "text-foreground",
            bg: "bg-muted/50",
          },
          {
            label: t("stats.completed"),
            value: classStats.reduce((s, c) => s + c.completedPeriods, 0),
            color: "text-emerald-700",
            bg: "bg-emerald-50",
          },
          {
            label: t("stats.remaining"),
            value: classStats.reduce((s, c) => s + c.remainingPeriods, 0),
            color: "text-amber-700",
            bg: "bg-amber-50",
          },
        ].map(card => (
          <div key={card.label} className={cn("rounded-lg p-3 border border-border", card.bg)}>
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={cn("text-2xl font-bold tabular-nums", card.color)}>{card.value}</p>
            <p className="text-[10px] text-muted-foreground">{t("stats.periodUnit")}</p>
          </div>
        ))}
      </div>

      {/* Grade groups */}
      {Object.entries(gradeGroups).sort().map(([grade, stats]) => (
        <GradeGroup key={grade} grade={grade} stats={stats} />
      ))}
    </>
  );
}

// ─── Annual Stats (all semesters) ────────────────────────────

function AnnualStatsView() {
  const { currentFile, asOfDate } = useTimetable();
  const { gradeColors } = useGradeColors();
  const { language, t } = useLanguage();

  // Collect all semesters
  const semesters = useMemo(() => {
    if (!currentFile) return [];
    if (currentFile.semesters && currentFile.semesters.length > 0) {
      return currentFile.semesters;
    }
    // Single semester fallback
    if (currentFile.semester) {
      return [{ semester: currentFile.semester, base: currentFile.base, ops: currentFile.ops }];
    }
    return [];
  }, [currentFile]);

  const getSemesterLabel = (sem: SemesterMeta) => {
    const system = sem.semesterSystem ?? "trimester";
    if (system === "semester") {
      return sem.semesterNumber === 1 ? t("weekGrid.firstTerm") : t("weekGrid.secondTerm");
    }
    return language === "ja" ? `${sem.semesterNumber}${t("weekGrid.termSuffix")}` : `${t("weekGrid.termSuffix")} ${sem.semesterNumber}`;
  };

  // Compute effective entries per semester and aggregate
  const annualStats = useMemo(() => {
    // Map: class -> { total, completed, byTerm }
    const totalMap = new Map<string, number>();
    const completedMap = new Map<string, number>();
    const byTermMap = new Map<string, { term: string; total: number; completed: number }[]>();

    for (const semData of semesters) {
      const { effective: rawEffective } = applyOverrides(semData.base, semData.ops ?? []);
      // 祝日マスク: 祝日日のコマはclass=nullにして時数計算から除外
      const semHolidayDates = new Set(
        (semData.semester.holidays ?? []).map((h: string | { date: string; name?: string }) => typeof h === 'string' ? h : h.date)
      );
      const effective = semHolidayDates.size > 0
        ? rawEffective.map(entry =>
            semHolidayDates.has(entry.date)
              ? { ...entry, periods: entry.periods.map(p => ({ ...p, class: null, subject: null })) }
              : entry
          )
        : rawEffective;
      const stats = calcClassStats(effective, asOfDate);
      const sem = semData.semester;
      const termLabel = getSemesterLabel(sem);

      for (const s of stats) {
        totalMap.set(s.class, (totalMap.get(s.class) ?? 0) + s.totalPeriods);
        completedMap.set(s.class, (completedMap.get(s.class) ?? 0) + s.completedPeriods);

        const existing = byTermMap.get(s.class) ?? [];
        byTermMap.set(s.class, [...existing, {
          term: termLabel,
          total: s.totalPeriods,
          completed: s.completedPeriods,
        }]);
      }
    }

    // Build sorted result
    const allClasses = Array.from(totalMap.keys()).sort(classSort);
    return allClasses.map(cls => ({
      class: cls,
      grade: cls.match(/^(\d+年)/)?.[1] ?? cls,
      total: totalMap.get(cls) ?? 0,
      completed: completedMap.get(cls) ?? 0,
      remaining: (totalMap.get(cls) ?? 0) - (completedMap.get(cls) ?? 0),
      completionRate: (totalMap.get(cls) ?? 0) > 0
        ? (completedMap.get(cls) ?? 0) / (totalMap.get(cls) ?? 0)
        : 0,
      byTerm: byTermMap.get(cls) ?? [],
    }));
  }, [semesters, asOfDate, language, t]);

  // Group by grade
  const gradeGroups = useMemo(() => {
    const groups: Record<string, typeof annualStats> = {};
    for (const s of annualStats) {
      if (!groups[s.grade]) groups[s.grade] = [];
      groups[s.grade].push(s);
    }
    return groups;
  }, [annualStats]);

  const termLabels = useMemo(() => {
    const labels: string[] = [];
    for (const semData of semesters) {
      const sem = semData.semester;
      const label = getSemesterLabel(sem);
      if (!labels.includes(label)) labels.push(label);
    }
    return labels;
  }, [semesters, language, t]);

  const totalAll = annualStats.reduce((s, c) => s + c.total, 0);
  const completedAll = annualStats.reduce((s, c) => s + c.completed, 0);
  const remainingAll = annualStats.reduce((s, c) => s + c.remaining, 0);

  const handleExportCSV = () => {
    exportAnnualStatsCSV(
      annualStats as AnnualClassStat[],
      termLabels,
      currentFile?.meta.title ?? t("home.titleFallback"),
    );
  };

  const handleExportExcel = async () => {
    await exportAnnualStatsExcel(
      annualStats as AnnualClassStat[],
      termLabels,
      currentFile?.meta.title ?? t("home.titleFallback"),
    );
  };

  return (
    <>
      {/* Export buttons */}
      <div className="flex items-center justify-end gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1.5 text-xs h-7">
          <Download size={12} />
          CSV
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1.5 text-xs h-7">
          <Download size={12} />
          Excel
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: t("stats.annualTotalPeriods"), value: totalAll, color: "text-foreground", bg: "bg-muted/50" },
          { label: t("stats.completed"), value: completedAll, color: "text-emerald-700", bg: "bg-emerald-50" },
          { label: t("stats.remaining"), value: remainingAll, color: "text-amber-700", bg: "bg-amber-50" },
        ].map(card => (
          <div key={card.label} className={cn("rounded-lg p-3 border border-border", card.bg)}>
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={cn("text-2xl font-bold tabular-nums", card.color)}>{card.value}</p>
            <p className="text-[10px] text-muted-foreground">
              {language === "ja"
                ? `${t("stats.periodUnit")}（${semesters.length}${t("stats.semesterTotalSuffix")}）`
                : `${t("stats.periodUnit")} (${semesters.length} ${semesters.length === 1 ? t("stats.termLowerSingular") : t("stats.termLowerPlural")} total)`}
            </p>
          </div>
        ))}
      </div>

      {/* Per-grade tables */}
      {Object.entries(gradeGroups).sort().map(([grade, stats]) => {
        const colors = getClassColor(stats[0]?.class ?? null, gradeColors);
        return (
          <div key={grade} className="mb-6">
            <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: colors.border }}
              />
              {grade}
            </h3>

            {/* Table with term breakdown */}
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("stats.class")}</th>
                    {termLabels.map(termLabel => (
                      <th key={termLabel} className="text-center px-2 py-2 font-medium text-muted-foreground">{termLabel}</th>
                    ))}
                    <th className="text-center px-2 py-2 font-medium text-foreground">{t("stats.total")}</th>
                    <th className="text-center px-2 py-2 font-medium text-emerald-700">{t("stats.doneShort")}</th>
                    <th className="text-center px-2 py-2 font-medium text-amber-700">{t("stats.remainingShort")}</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">{t("stats.progress")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, i) => {
                    const pct = Math.round(s.completionRate * 100);
                    const rowColors = getClassColor(s.class, gradeColors);
                    return (
                      <tr
                        key={s.class}
                        className={cn(
                          "border-t border-border/50",
                          i % 2 === 0 ? "bg-background" : "bg-muted/20"
                        )}
                      >
                        <td className="px-3 py-2 font-medium" style={{ color: rowColors.text }}>
                          {s.class}
                        </td>
                        {termLabels.map(termLabel => {
                          const termData = s.byTerm.find(bt => bt.term === termLabel);
                          return (
                            <td key={termLabel} className="text-center px-2 py-2 tabular-nums text-muted-foreground">
                              {termData ? (
                                <span>
                                  <span className="text-foreground font-medium">{termData.total}</span>
                                  <span className="text-[9px] text-muted-foreground/60">{formatPeriodUnit(language, t("stats.periodUnit"))}</span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground/30">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center px-2 py-2 font-bold tabular-nums">{s.total}</td>
                        <td className="text-center px-2 py-2 tabular-nums text-emerald-600 font-medium">{s.completed}</td>
                        <td className="text-center px-2 py-2 tabular-nums text-amber-600 font-medium">{s.remaining}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 justify-end">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: rowColors.border,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {semesters.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          {t("stats.noMultiSemester")}
        </div>
      )}
    </>
  );
}

// ─── Subject Stats View ─────────────────────────────────────

function SubjectStatsView({
  subjectStats,
  asOfDate,
  setAsOfDate,
}: {
  subjectStats: SubjectStats[];
  asOfDate: string;
  setAsOfDate: (d: string) => void;
}) {
  const { subjectColors } = useGradeColors();
  const { t } = useLanguage();

  if (subjectStats.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">{t("stats.noSubjectData")}</p>
        <p className="text-xs text-muted-foreground/60 mt-1">{t("stats.subjectDataHint")}</p>
      </div>
    );
  }

  const totalAll = subjectStats.reduce((s, c) => s + c.totalPeriods, 0);
  const completedAll = subjectStats.reduce((s, c) => s + c.completedPeriods, 0);
  const remainingAll = subjectStats.reduce((s, c) => s + c.remainingPeriods, 0);

  return (
    <>
      {/* as_of date picker */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">{t("stats.asOfDate")}</Label>
          <Input
            type="date"
            value={asOfDate}
            onChange={e => setAsOfDate(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>
        <button
          onClick={() => setAsOfDate(todayISO())}
          className="text-xs text-primary hover:underline"
        >
          {t("stats.backToToday")}
        </button>
        <span className="text-xs text-muted-foreground">
          {t("stats.asOfHelp")}
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: t("stats.totalPeriods"), value: totalAll, color: "text-foreground", bg: "bg-muted/50" },
          { label: t("stats.completed"), value: completedAll, color: "text-emerald-700", bg: "bg-emerald-50" },
          { label: t("stats.remaining"), value: remainingAll, color: "text-amber-700", bg: "bg-amber-50" },
        ].map(card => (
          <div key={card.label} className={cn("rounded-lg p-3 border border-border", card.bg)}>
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={cn("text-2xl font-bold tabular-nums", card.color)}>{card.value}</p>
            <p className="text-[10px] text-muted-foreground">{t("stats.periodUnit")}</p>
          </div>
        ))}
      </div>

      {/* Subject rows */}
      <div className="space-y-2">
        {subjectStats.map(s => {
          const colors = getSubjectColor(s.subject, subjectColors);
          const pct = Math.round(s.completionRate * 100);
          const totalPct = totalAll > 0 ? Math.round(s.totalPeriods / totalAll * 100) : 0;
          return (
            <div key={s.subject} className="bg-card border border-border rounded-lg px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full border"
                    style={{ backgroundColor: colors.bg, borderColor: colors.border }}
                  />
                  <span className="text-sm font-medium" style={{ color: colors.text }}>{s.subject}</span>
                  <span className="text-[10px] text-muted-foreground/60 bg-muted/50 rounded px-1">{totalPct}%</span>
                </div>
                <div className="flex items-center gap-3 text-xs tabular-nums">
                  <span className="text-muted-foreground">{t("stats.totalShort")} <span className="font-bold text-foreground">{s.totalPeriods}</span></span>
                  <span className="text-emerald-600">{t("stats.doneShort")} <span className="font-bold">{s.completedPeriods}</span></span>
                  <span className="text-amber-600">{t("stats.remainingShort")} <span className="font-bold">{s.remainingPeriods}</span></span>
                  <span className="text-muted-foreground font-medium">{pct}%</span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: colors.border }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Grade Group (semester view) ─────────────────────────────

function GradeGroup({ grade, stats }: { grade: string; stats: ClassStats[] }) {
  const { gradeColors } = useGradeColors();
  const colors = getClassColor(stats[0]?.class ?? null, gradeColors);

  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: colors.border }}
        />
        {grade}
      </h3>
      <div className="space-y-2">
        {stats.map(s => (
          <ClassStatRow key={s.class} stat={s} />
        ))}
      </div>
    </div>
  );
}

function ClassStatRow({ stat }: { stat: ClassStats }) {
  const { gradeColors } = useGradeColors();
  const { t } = useLanguage();
  const colors = getClassColor(stat.class, gradeColors);
  const pct = Math.round(stat.completionRate * 100);

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: colors.text }}>{stat.class}</span>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground">{t("stats.totalShort")} <span className="font-bold text-foreground">{stat.totalPeriods}</span></span>
          <span className="text-emerald-600">{t("stats.doneShort")} <span className="font-bold">{stat.completedPeriods}</span></span>
          <span className="text-amber-600">{t("stats.remainingShort")} <span className="font-bold">{stat.remainingPeriods}</span></span>
          <span className="text-muted-foreground font-medium">{pct}%</span>
        </div>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: colors.border }}
        />
      </div>
    </div>
  );
}

// ─── History View ─────────────────────────────────────────────

export function HistoryView() {
  const { undoStack, undo, isLoaded } = useTimetable();
  const { language, t } = useLanguage();

  if (!isLoaded) {
    return <EmptyState message={t("history.emptyLoad")} />;
  }

  if (undoStack.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
        <Info size={24} className="text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{t("history.noneTitle")}</p>
        <p className="text-xs text-muted-foreground/60">{t("history.noneDescription")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">{t("history.title")}</h2>
        <span className="text-xs text-muted-foreground">{formatItemCount(undoStack.length, language)}</span>
      </div>
      <div className="space-y-2">
        {[...undoStack].reverse().map((entry, i) => (
          <div
            key={i}
            className="bg-card border border-border rounded-lg px-4 py-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{entry.description}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(entry.timestamp).toLocaleString(language === "ja" ? "ja-JP" : "en-US")}
                  {" · "}{formatOperationCount(entry.ops.length, language)}
                </p>
              </div>
              {i === 0 && (
                <button
                  onClick={undo}
                  className="text-[10px] text-primary hover:underline shrink-0"
                >
                  {t("history.undo")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Audit Log View ───────────────────────────────────────────

export function AuditView() {
  const { auditLog, isLoaded } = useTimetable();
  const { language, t } = useLanguage();

  if (!isLoaded) {
    return <EmptyState message={t("audit.emptyLoad")} />;
  }

  const warns = auditLog.filter(a => a.level === "warn").length;
  const errors = auditLog.filter(a => a.level === "error").length;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">{t("audit.title")}</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{formatItemCount(auditLog.length, language)}</span>
          {warns > 0 && (
            <span className="text-amber-600 font-medium">
              {language === "ja" ? `${t("audit.warning")} ${formatItemCount(warns, language)}` : `${warns} ${warns === 1 ? "warning" : "warnings"}`}
            </span>
          )}
          {errors > 0 && (
            <span className="text-red-600 font-medium">
              {language === "ja" ? `${t("audit.error")} ${formatItemCount(errors, language)}` : `${errors} ${errors === 1 ? "error" : "errors"}`}
            </span>
          )}
        </div>
      </div>

      {auditLog.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">{t("audit.none")}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...auditLog].reverse().map((entry, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-2.5 rounded-md px-3 py-2 border text-xs",
                entry.level === "warn" ? "bg-amber-50 border-amber-200" :
                entry.level === "error" ? "bg-red-50 border-red-200" :
                "bg-muted/30 border-border/50"
              )}
            >
              <div className="mt-0.5 shrink-0">
                {entry.level === "warn" ? (
                  <AlertTriangle size={12} className="text-amber-500" />
                ) : entry.level === "error" ? (
                  <AlertTriangle size={12} className="text-red-500" />
                ) : (
                  <CheckCircle size={12} className="text-emerald-500" />
                )}
              </div>
              <div className="min-w-0">
                <span className="font-medium text-foreground">{entry.message}</span>
                {(entry.date || entry.period) && (
                  <span className="text-muted-foreground ml-1.5">
                    {entry.date}{entry.period ? (language === "ja" ? ` ${entry.period}${t("audit.periodSuffix")}` : ` ${t("audit.periodSuffix")} ${entry.period}`) : ""}
                  </span>
                )}
                {(entry.before !== undefined || entry.after !== undefined) && (
                  <span className="text-muted-foreground ml-1.5">
                    {entry.before ?? "null"} → {entry.after ?? "null"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <p className="text-sm text-muted-foreground text-center">{message}</p>
    </div>
  );
}
