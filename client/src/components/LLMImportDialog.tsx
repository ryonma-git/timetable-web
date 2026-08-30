// Design: Swiss Grid × Japanese Functional Design
// LLMImportDialog: LLM連携による画像からの時間割・時程表・年間予定表読み取り支援ダイアログ

import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Bot, Download, Copy, Check, FileJson, Clock, ChevronRight,
  Calendar, Upload, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { useTimetable } from "@/contexts/TimetableContext";
import {
  generateTimetableTemplate,
  generatePeriodTimesTemplate,
  generateScheduleTemplate,
  generateTimetablePrompt,
  generatePeriodTimesPrompt,
  generateSchedulePrompt,
  downloadJSON,
  copyToClipboard,
} from "@/lib/llmImport";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { applyOverrides } from "@/lib/timetable";
import type { OverrideOp, DailyEvent } from "@/lib/timetable";
import { nanoid } from "nanoid";
import { useLanguage, type TranslationKey } from "@/contexts/LanguageContext";

export type LLMImportMode = "timetable" | "period_times" | "schedule";

interface LLMImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: LLMImportMode;
}

// ─── 時程表JSONのパース ───────────────────────────────────────────
function parsePeriodTimesJSON(json: string): {
  periodTimes?: Record<number, { start: string; end: string }>;
  periodTimesByDay?: Record<string, Record<number, { start: string; end: string }>>;
} | null {
  try {
    const parsed = JSON.parse(json);
    const mode = parsed.mode ?? "shared";
    const shared = parsed.shared as Record<string, { start: string; end: string }> | undefined;
    const byDay = parsed.by_day as Record<string, Record<string, { start: string; end: string }>> | undefined;

    if (!shared) return null;

    // shared → Record<number, {start, end}>
    const periodTimes: Record<number, { start: string; end: string }> = {};
    for (const [k, v] of Object.entries(shared)) {
      const n = parseInt(k);
      if (!isNaN(n) && v?.start && v?.end) periodTimes[n] = { start: v.start, end: v.end };
    }

    if (mode === "by_day" && byDay) {
      const periodTimesByDay: Record<string, Record<number, { start: string; end: string }>> = {};
      for (const [day, dayData] of Object.entries(byDay)) {
        periodTimesByDay[day] = {};
        for (const [k, v] of Object.entries(dayData)) {
          const n = parseInt(k);
          if (!isNaN(n) && v?.start && v?.end) periodTimesByDay[day][n] = { start: v.start, end: v.end };
        }
      }
      return { periodTimes, periodTimesByDay };
    }

    return { periodTimes };
  } catch {
    return null;
  }
}

// ─── 年間予定表JSONのパース（v91: events + ops 2層構造） ───────────────────────
interface ParsedSchedule {
  ops: OverrideOp[];
  events: Array<{ date: string; event: DailyEvent }>;
}

function parseScheduleJSON(json: string): ParsedSchedule | null {
  try {
    const parsed = JSON.parse(json);
    // events: 旧形式（events配列なし）でも動作するように optional
    const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
    const rawOps = Array.isArray(parsed.ops) ? parsed.ops : (Array.isArray(parsed) ? parsed : []);

    // events パース：YYYY-MM-DD形式・空titleを除外、テンプレ用プレースホルダ"YYYY-MM-DD"も除外
    const events: Array<{ date: string; event: DailyEvent }> = [];
    for (const e of rawEvents) {
      if (typeof e !== "object" || e === null) continue;
      const obj = e as Record<string, unknown>;
      const date = typeof obj.date === "string" ? obj.date : "";
      const title = typeof obj.title === "string" ? obj.title.trim() : "";
      if (!date || !title) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // テンプレ"YYYY-MM-DD"は弾く
      // 旧カテゴリ名のフォールバック互換（drill→student, meeting→work）
      let rawCat = typeof obj.category === "string" ? obj.category.trim() : "";
      if (rawCat === "drill") rawCat = "student";
      if (rawCat === "meeting") rawCat = "work";
      // v93: 任意文字列を許容（既定6種以外はカスタムタグとして扱う）
      const category: string = rawCat || "other";
      events.push({
        date,
        event: {
          id: nanoid(8),
          title,
          category,
          notes: typeof obj.notes === "string" ? obj.notes : undefined,
          timeStart: typeof obj.timeStart === "string" ? obj.timeStart : undefined,
          timeEnd: typeof obj.timeEnd === "string" ? obj.timeEnd : undefined,
          affectsClasses: typeof obj.affectsClasses === "boolean" ? obj.affectsClasses : undefined,
        },
      });
    }

    // ops パース：date がテンプレ"YYYY-MM-DD"のものは除外
    const ops: OverrideOp[] = [];
    for (const op of rawOps) {
      if (typeof op !== "object" || op === null) continue;
      const o = op as Record<string, unknown>;
      if (typeof o.op !== "string" || typeof o.date !== "string") continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) continue;
      ops.push(op as OverrideOp);
    }

    if (events.length === 0 && ops.length === 0) return null;
    return { ops, events };
  } catch {
    return null;
  }
}

// v106 Phase D: 重複判定用の正規化（全半角・空白・記号を吸収、同一日付前提の部分一致）
function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[（）()【】[\]「」『』・,、。．.\-―ー]/g, "")
    .toLowerCase();
}
function isDuplicateTitle(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na.length < 2 || nb.length < 2) return na === nb;
  return na.includes(nb) || nb.includes(na);
}

// applyOps() は「今回のimport分だけ」ではなく累積ops全体に対するauditを返すため、
// 末尾から submittedCount 件を「今回渡したopsに対応する結果」とみなして判定する。
// （applyOverridesは渡されたopsを順番に処理してauditに積むため、末尾が今回分になる。
//   date not foundやclear_period_classは必ず1件のaudit entryを積むため、通常のケースでは
//   この対応関係は正確に成立する）
function countFailedOps(audit: { level: "info" | "warn" | "error" }[], submittedCount: number): number {
  if (submittedCount === 0) return 0;
  return audit.slice(-submittedCount).filter(a => a.level === "warn" || a.level === "error").length;
}

type ScheduleScope = "events_only" | "with_ops";
type ScheduleMode = "append" | "overwrite";

interface DupCandidate {
  date: string;
  newEvent: DailyEvent;
  existingTitle: string;
  accept: boolean; // true=追加する / false=スキップ
  semesterIdx: number;
}

interface PendingPlan {
  dups: DupCandidate[];
  autoEventOpsBySem: Record<number, OverrideOp[]>; // 重複なしで自動追加するadd_day_event（学期別）
  classOpsBySem: Record<number, OverrideOp[]>;      // コマ削除等（学期別・scopeがwith_opsのとき）
  eventsTotal: number;
  opsTotal: number;
}

type ApplyTargetScope = "active" | "all";

export function LLMImportDialog({ open, onOpenChange, mode = "timetable" }: LLMImportDialogProps) {
  const {
    semester, updateSettings, applyOps, effectiveEntries,
    currentFile, activeSemesterIndex, applyOpsToSemester, findSemesterIndexForDate,
  } = useTimetable();
  const { t } = useLanguage();
  const lf = (key: TranslationKey, vars: Record<string, string | number> = {}) => {
    let s: string = t(key);
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [activeMode, setActiveMode] = useState<LLMImportMode>(mode);
  const [importJson, setImportJson] = useState("");
  const [userRules, setUserRules] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  // v106 Phase D
  const [scheduleScope, setScheduleScope] = useState<ScheduleScope>("events_only");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("append");
  const [overwriteAll, setOverwriteAll] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  // v109: 複数学期ファイルのとき、年間予定表の反映先を「この学期のみ」か「年度丸ごと」から選べる
  const [applyTargetScope, setApplyTargetScope] = useState<ApplyTargetScope>("active");
  const hasMultipleSemesters = (currentFile?.semesters?.length ?? 0) > 1;

  // 指定学期の「既存の日次イベント」を取得する（重複チェック・上書き範囲クリア用）。
  // アクティブ学期はライブのeffectiveEntriesを使い、それ以外はbase/opsから都度計算する。
  const getExistingEventsForSemester = useCallback((semIdx: number): Array<{ date: string; id: string; title: string }> => {
    const out: Array<{ date: string; id: string; title: string }> = [];
    const collect = (entries: typeof effectiveEntries) => {
      for (const e of entries) {
        for (const ev of e.dayEvents ?? []) out.push({ date: e.date, id: ev.id, title: ev.title });
      }
    };
    if (!currentFile?.semesters || semIdx === activeSemesterIndex || !currentFile.semesters[semIdx]) {
      collect(effectiveEntries);
      return out;
    }
    const sem = currentFile.semesters[semIdx];
    const { effective } = applyOverrides(sem.base, sem.ops ?? []);
    collect(effective);
    return out;
  }, [currentFile, activeSemesterIndex, effectiveEntries]);

  // scope="active"なら常にアクティブ学期、"all"なら日付から所属学期を判定する
  const resolveSemIdx = useCallback((dateStr: string): number => {
    if (applyTargetScope === "active" || !hasMultipleSemesters) return activeSemesterIndex;
    return findSemesterIndexForDate(dateStr);
  }, [applyTargetScope, hasMultipleSemesters, activeSemesterIndex, findSemesterIndexForDate]);

  // ダイアログが開くたびにmodeに合わせてactiveModeをリセット
  useEffect(() => {
    if (open) {
      setActiveMode(mode);
      setImportJson("");
      setParseError(null);
      setImportSuccess(false);
      setCopiedPrompt(false);
      setCopiedTemplate(false);
      setPendingPlan(null);
    }
  }, [open, mode]);

  if (!semester) return null;

  const handleDownloadTemplate = () => {
    if (activeMode === "timetable") {
      downloadJSON(generateTimetableTemplate(semester), "timetable_template");
    } else if (activeMode === "period_times") {
      downloadJSON(generatePeriodTimesTemplate(semester), "period_times_template");
    } else {
      downloadJSON(generateScheduleTemplate(semester), "schedule_template");
    }
  };

  const handleCopyTemplate = async () => {
    let data: unknown;
    if (activeMode === "timetable") data = generateTimetableTemplate(semester);
    else if (activeMode === "period_times") data = generatePeriodTimesTemplate(semester);
    else data = generateScheduleTemplate(semester);
    await copyToClipboard(JSON.stringify(data, null, 2));
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  // v107 Phase J: プロンプトにJSONテンプレートを内包して1本化（コピペ往復を解消）
  const buildFullPrompt = (): string => {
    if (activeMode === "timetable") {
      return generateTimetablePrompt(semester)
        + t("llm.templateAppend")
        + JSON.stringify(generateTimetableTemplate(semester), null, 2);
    }
    if (activeMode === "period_times") {
      return generatePeriodTimesPrompt()
        + t("llm.templateAppend")
        + JSON.stringify(generatePeriodTimesTemplate(semester), null, 2);
    }
    // schedule: events_only のときはコマ削除ルールを渡さない
    const rules = scheduleScope === "with_ops" ? userRules : "";
    return generateSchedulePrompt(semester, rules)
      + t("llm.templateAppend")
      + JSON.stringify(generateScheduleTemplate(semester), null, 2);
  };

  const handleCopyPrompt = async () => {
    await copyToClipboard(buildFullPrompt());
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleImport = useCallback(() => {
    setParseError(null);
    setImportSuccess(false);

    if (!importJson.trim()) {
      setParseError(t("llm.errPasteJson"));
      return;
    }

    if (activeMode === "timetable") {
      // 時間割インポートはPatchImportDialogへ誘導（複雑なため）
      // ここでは簡易パース確認のみ
      try {
        JSON.parse(importJson);
        toast.info(t("llm.infoTimetableChecked"));
        setImportSuccess(true);
      } catch {
        setParseError(t("llm.errJsonFormat"));
      }
    } else if (activeMode === "period_times") {
      const result = parsePeriodTimesJSON(importJson);
      if (!result) {
        setParseError(t("llm.errPeriodTimesFormat"));
        return;
      }
      const newSemester = {
        ...semester,
        ...(result.periodTimes ? { periodTimes: result.periodTimes } : {}),
        ...(result.periodTimesByDay ? { periodTimesByDay: result.periodTimesByDay } : {}),
      };
      updateSettings(newSemester);
      toast.success(t("llm.okPeriodTimesUpdated"));
      setImportSuccess(true);
      setImportJson("");
    } else {
      // schedule mode (v106 Phase D: スコープ/モード/重複チェック, v109: 学期別グルーピング)
      const parsed = parseScheduleJSON(importJson);
      if (!parsed) {
        setParseError(t("llm.errScheduleFormat"));
        return;
      }

      // スコープ: 予定欄だけ → コマ削除ops(parsed.ops)は無視
      const classOpsAll: OverrideOp[] = scheduleScope === "with_ops" ? parsed.ops : [];

      if (parsed.events.length === 0 && classOpsAll.length === 0) {
        setParseError(t("llm.errNothingToApply"));
        return;
      }

      // 反映先の学期一覧（"この学期のみ"なら1つ、"年度丸ごと"ならファイル内の全学期）
      const targetSemIndices = applyTargetScope === "all" && hasMultipleSemesters
        ? currentFile!.semesters!.map((_, i) => i)
        : [activeSemesterIndex];

      if (scheduleMode === "overwrite") {
        // 上書き: 学期ごとに「全クリア」または「取込日付範囲のみクリア」してから入れ替え
        let totalReplaced = 0, totalRemoved = 0, totalClassOk = 0, totalClassFail = 0;
        for (const semIdx of targetSemIndices) {
          const existing = getExistingEventsForSemester(semIdx);
          const eventsForSem = parsed.events.filter(e => resolveSemIdx(e.date) === semIdx);
          const classOpsForSem = classOpsAll.filter(op => resolveSemIdx(op.date) === semIdx);
          let targets = existing;
          if (!overwriteAll) {
            if (eventsForSem.length === 0) {
              targets = [];
            } else {
              const dates = eventsForSem.map(e => e.date).sort();
              const minD = dates[0], maxD = dates[dates.length - 1];
              targets = existing.filter(x => x.date >= minD && x.date <= maxD);
            }
          }
          if (eventsForSem.length === 0 && classOpsForSem.length === 0 && targets.length === 0) continue;
          const removeOps: OverrideOp[] = targets.map(x => ({
            id: nanoid(8), op: "remove_day_event" as const, date: x.date, event_id: x.id,
          }));
          const addOps: OverrideOp[] = eventsForSem.map(({ date, event }) => ({
            id: nanoid(8), op: "add_day_event" as const, date, event,
          }));
          const audit = applyOpsToSemester(semIdx, [...removeOps, ...addOps, ...classOpsForSem], "年間予定表LLMインポート（上書き）");
          const fail = countFailedOps(audit, classOpsForSem.length);
          totalReplaced += eventsForSem.length;
          totalRemoved += removeOps.length;
          totalClassOk += classOpsForSem.length - fail;
          totalClassFail += fail;
        }
        const msgs: string[] = [];
        if (totalReplaced > 0) msgs.push(lf("llm.replacedWithEvents", { n: totalReplaced }));
        if (totalRemoved > 0) msgs.push(lf("llm.removedOld", { n: totalRemoved }));
        if (totalClassOk > 0) msgs.push(lf("llm.classChanges", { n: totalClassOk }));
        if (totalClassFail > 0) {
          toast.warning(`${msgs.join(" · ")}${lf("llm.classChangesFailed", { n: totalClassFail })}`);
        } else {
          toast.success(msgs.join(" · "));
        }
        setImportSuccess(true);
        setImportJson("");
        return;
      }

      // 追記: 学期ごとに重複チェック（同一日付・正規化部分一致）
      const dups: DupCandidate[] = [];
      const autoEventOpsBySem: Record<number, OverrideOp[]> = {};
      const classOpsBySem: Record<number, OverrideOp[]> = {};
      for (const semIdx of targetSemIndices) {
        const existing = getExistingEventsForSemester(semIdx);
        const eventsForSem = parsed.events.filter(e => resolveSemIdx(e.date) === semIdx);
        const auto: OverrideOp[] = [];
        for (const { date, event } of eventsForSem) {
          const hit = existing.find(x => x.date === date && isDuplicateTitle(x.title, event.title));
          if (hit) {
            dups.push({ date, newEvent: event, existingTitle: hit.title, accept: false, semesterIdx: semIdx });
          } else {
            auto.push({ id: nanoid(8), op: "add_day_event", date, event });
          }
        }
        if (auto.length > 0) autoEventOpsBySem[semIdx] = auto;
        const classOpsForSem = classOpsAll.filter(op => resolveSemIdx(op.date) === semIdx);
        if (classOpsForSem.length > 0) classOpsBySem[semIdx] = classOpsForSem;
      }

      if (dups.length > 0) {
        // 確認ダイアログで個別選択
        setPendingPlan({
          dups, autoEventOpsBySem, classOpsBySem,
          eventsTotal: parsed.events.length, opsTotal: classOpsAll.length,
        });
        return;
      }

      // 重複なし → 学期ごとにそのまま適用
      let totalAppended = 0, totalClassOk2 = 0, totalClassFail2 = 0;
      for (const semIdx of targetSemIndices) {
        const auto = autoEventOpsBySem[semIdx] ?? [];
        const cls = classOpsBySem[semIdx] ?? [];
        if (auto.length === 0 && cls.length === 0) continue;
        const audit = applyOpsToSemester(semIdx, [...auto, ...cls], "年間予定表LLMインポート（追記）");
        const fail = countFailedOps(audit, cls.length);
        totalAppended += auto.length;
        totalClassOk2 += cls.length - fail;
        totalClassFail2 += fail;
      }
      const msgs2: string[] = [];
      if (totalAppended > 0) msgs2.push(lf("llm.eventsAppended", { n: totalAppended }));
      if (totalClassOk2 > 0) msgs2.push(lf("llm.classChanges", { n: totalClassOk2 }));
      if (totalClassFail2 > 0) {
        toast.warning(`${msgs2.join(" · ") || t("llm.applied")}${lf("llm.classChangesFailed", { n: totalClassFail2 })}`);
      } else {
        toast.success(msgs2.join(" · ") || t("llm.applied"));
      }
      setImportSuccess(true);
      setImportJson("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, importJson, semester, updateSettings, applyOps, applyOpsToSemester, effectiveEntries, scheduleScope, scheduleMode, overwriteAll, t, applyTargetScope, hasMultipleSemesters, currentFile, activeSemesterIndex, getExistingEventsForSemester, resolveSemIdx]);

  // v106 Phase D: 重複確認ダイアログから最終適用（v109: 学期別に適用）
  const applyPendingPlan = useCallback(() => {
    if (!pendingPlan) return;
    const dupAddOpsBySem: Record<number, OverrideOp[]> = {};
    let dupAddedCount = 0;
    for (const d of pendingPlan.dups) {
      if (!d.accept) continue;
      const op: OverrideOp = { id: nanoid(8), op: "add_day_event" as const, date: d.date, event: d.newEvent };
      (dupAddOpsBySem[d.semesterIdx] ??= []).push(op);
      dupAddedCount++;
    }
    const semIndices = Array.from(new Set([
      ...Object.keys(pendingPlan.autoEventOpsBySem).map(Number),
      ...Object.keys(pendingPlan.classOpsBySem).map(Number),
      ...Object.keys(dupAddOpsBySem).map(Number),
    ]));
    let totalAdded = 0, totalClassOk = 0, totalClassFail = 0;
    for (const semIdx of semIndices) {
      const auto = pendingPlan.autoEventOpsBySem[semIdx] ?? [];
      const dupAdd = dupAddOpsBySem[semIdx] ?? [];
      const cls = pendingPlan.classOpsBySem[semIdx] ?? [];
      const all = [...auto, ...dupAdd, ...cls];
      if (all.length === 0) continue;
      const audit = applyOpsToSemester(semIdx, all, "年間予定表LLMインポート（追記・重複確認済み）");
      const fail = countFailedOps(audit, cls.length);
      totalAdded += auto.length + dupAdd.length;
      totalClassOk += cls.length - fail;
      totalClassFail += fail;
    }
    if (totalAdded === 0 && totalClassOk === 0 && totalClassFail === 0) {
      toast.info(t("llm.infoNothingToAdd"));
      setPendingPlan(null);
      return;
    }
    const skipped = pendingPlan.dups.length - dupAddedCount;
    const summary =
      lf("llm.appendSummary", { added: totalAdded })
      + (skipped > 0 ? lf("llm.skippedSuffix", { n: skipped }) : "")
      + (totalClassOk > 0 ? lf("llm.classChangesSuffix", { n: totalClassOk }) : "");
    if (totalClassFail > 0) {
      toast.warning(`${summary}${lf("llm.classChangesFailed", { n: totalClassFail })}`);
    } else {
      toast.success(summary);
    }
    setPendingPlan(null);
    setImportSuccess(true);
    setImportJson("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlan, applyOpsToSemester, t]);

  const modeConfig = {
    timetable: {
      icon: <FileJson size={13} />,
      label: t("llm.modeTimetable"),
      desc: t("llm.descTimetable"),
      templateName: "timetable_template.json",
      importPlaceholder: t("llm.phTimetable"),
      importNote: t("llm.noteTimetable"),
    },
    period_times: {
      icon: <Clock size={13} />,
      label: t("llm.modePeriodTimes"),
      desc: t("llm.descPeriodTimes"),
      templateName: "period_times_template.json",
      importPlaceholder: t("llm.phPeriodTimes"),
      importNote: t("llm.notePeriodTimes"),
    },
    schedule: {
      icon: <Calendar size={13} />,
      label: t("llm.modeSchedule"),
      desc: t("llm.descSchedule"),
      templateName: "schedule_template.json",
      importPlaceholder: t("llm.phSchedule"),
      importNote: t("llm.noteSchedule"),
    },
  };

  const cfg = modeConfig[activeMode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot size={18} className="text-primary" />
            {t("llm.dialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("llm.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        {/* モード切り替え */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          {(["timetable", "period_times", "schedule"] as LLMImportMode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setActiveMode(m);
                setImportJson("");
                setParseError(null);
                setImportSuccess(false);
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-all",
                activeMode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {modeConfig[m].icon}
              {modeConfig[m].label}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground -mt-1">{cfg.desc}</p>

        {/* v106 Phase D: 年間予定表の取込スコープ・モード */}
        {activeMode === "schedule" && (
          <div className="rounded-lg border border-border p-3 space-y-2.5 bg-muted/20">
            <div>
              <p className="text-xs font-medium mb-1">{t("llm.scopeLabel")}</p>
              <div className="flex gap-2">
                {([["with_ops", t("llm.scopeWithOps"), t("llm.scopeWithOpsDesc")], ["events_only", t("llm.scopeEventsOnly"), t("llm.scopeEventsOnlyDesc")]] as [ScheduleScope, string, string][]).map(([v, label, desc]) => (
                  <button key={v} onClick={() => setScheduleScope(v)}
                    title={desc}
                    className={cn(
                      "flex-1 text-left px-2.5 py-1.5 rounded-md border text-xs transition-colors",
                      scheduleScope === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40",
                    )}>
                    <div className="font-medium">{label}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium mb-1">{t("llm.modeLabel")}</p>
              <div className="flex gap-2">
                {([["append", t("llm.modeAppend"), t("llm.modeAppendDesc")], ["overwrite", t("llm.modeOverwrite"), t("llm.modeOverwriteDesc")]] as [ScheduleMode, string, string][]).map(([v, label, desc]) => (
                  <button key={v} onClick={() => setScheduleMode(v)}
                    title={desc}
                    className={cn(
                      "flex-1 text-left px-2.5 py-1.5 rounded-md border text-xs transition-colors",
                      scheduleMode === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40",
                    )}>
                    <div className="font-medium">{label}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{desc}</div>
                  </button>
                ))}
              </div>
            </div>
            {hasMultipleSemesters && (
              <div>
                <p className="text-xs font-medium mb-1">{t("llm.applyTargetLabel")}</p>
                <div className="flex gap-2">
                  {([["active", t("llm.applyTargetActive"), t("llm.applyTargetActiveDesc")], ["all", t("llm.applyTargetAll"), t("llm.applyTargetAllDesc")]] as [ApplyTargetScope, string, string][]).map(([v, label, desc]) => (
                    <button key={v} onClick={() => setApplyTargetScope(v)}
                      title={desc}
                      className={cn(
                        "flex-1 text-left px-2.5 py-1.5 rounded-md border text-xs transition-colors",
                        applyTargetScope === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40",
                      )}>
                      <div className="font-medium">{label}</div>
                      <div className="text-[10px] opacity-70 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {scheduleMode === "overwrite" && (
              <label className="flex items-center gap-2 text-xs cursor-pointer pt-0.5">
                <input type="checkbox" checked={overwriteAll}
                  onChange={e => setOverwriteAll(e.target.checked)} className="w-3.5 h-3.5" />
                <span>{t("llm.clearAllPrefix")}<strong>{t("llm.clearAllWord")}</strong>{t("llm.clearAllSuffix")}</span>
              </label>
            )}
            <p className="text-[10px] text-muted-foreground/70">
              {scheduleScope === "events_only"
                ? t("llm.scopeNoteProtected")
                : t("llm.scopeNoteCut")}
              {scheduleMode === "append" ? t("llm.modeNoteAppend") : overwriteAll ? t("llm.modeNoteOverwriteAll") : t("llm.modeNoteOverwriteRange")}
            </p>
          </div>
        )}

        {/* 手順 */}
        <div className="space-y-3">
          {/* Step 1: 個別ルール（年間予定表 かつ コマ削除含む のときのみ・J1） */}
          {activeMode === "schedule" && scheduleScope === "with_ops" && (
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">1</div>
                <div className="w-px flex-1 bg-border mt-1" />
              </div>
              <div className="pb-3 flex-1">
                <p className="text-sm font-medium mb-0.5">{t("llm.stepRuleTitle")}</p>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("llm.stepRuleDesc")}
                </p>
                <Textarea
                  value={userRules}
                  onChange={(e) => setUserRules(e.target.value)}
                  placeholder={t("llm.stepRulePh")}
                  className="text-xs min-h-[60px] resize-none"
                />
              </div>
            </div>
          )}

          {/* Step: プロンプトをコピー（JSONテンプレ内包・1本化 J2） */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {activeMode === "schedule" && scheduleScope === "with_ops" ? "2" : "1"}
              </div>
              <div className="w-px flex-1 bg-border mt-1" />
            </div>
            <div className="pb-3 flex-1">
              <p className="text-sm font-medium mb-0.5">{t("llm.stepPromptTitle")}</p>
              <p className="text-xs text-muted-foreground mb-2">
                {t("llm.stepPromptDesc")}
              </p>
              <Button size="sm" className="gap-1.5 text-xs" onClick={handleCopyPrompt}>
                {copiedPrompt ? <Check size={12} className="text-white" /> : <Copy size={12} />}
                {copiedPrompt ? t("llm.copied") : t("llm.copyPromptWithTemplate")}
              </Button>
              {/* 上級者向け: JSONテンプレートのみ */}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/60">{t("llm.advanced")}</span>
                <button onClick={handleCopyTemplate}
                  className="text-[10px] text-muted-foreground/70 hover:text-foreground hover:underline flex items-center gap-0.5">
                  {copiedTemplate ? <Check size={9} className="text-green-500" /> : <Copy size={9} />}
                  {t("llm.copyTemplateOnly")}
                </button>
                <button onClick={handleDownloadTemplate}
                  className="text-[10px] text-muted-foreground/70 hover:text-foreground hover:underline flex items-center gap-0.5">
                  <Download size={9} />{t("llm.download")}
                </button>
              </div>
            </div>
          </div>

          {/* Step: LLMに渡す */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {activeMode === "schedule" && scheduleScope === "with_ops" ? "3" : "2"}
              </div>
              <div className="w-px flex-1 bg-border mt-1" />
            </div>
            <div className="pb-3 flex-1">
              <p className="text-sm font-medium mb-0.5">{t("llm.stepPasteTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("llm.stepPasteDesc")}
              </p>
            </div>
          </div>

          {/* Step: JSONを貼り付けてインポート */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {activeMode === "schedule" && scheduleScope === "with_ops" ? "4" : "3"}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium mb-0.5">{t("llm.stepImportTitle")}</p>
              <p className="text-xs text-muted-foreground mb-2">{cfg.importNote}</p>
              <Textarea
                value={importJson}
                onChange={(e) => {
                  setImportJson(e.target.value);
                  setParseError(null);
                  setImportSuccess(false);
                }}
                placeholder={cfg.importPlaceholder}
                className="text-xs font-mono min-h-[80px] resize-none mb-2"
              />
              {parseError && (
                <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 mb-2">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {parseError}
                </div>
              )}
              {importSuccess && (
                <div className="flex items-start gap-1.5 text-xs text-green-600 dark:text-green-400 mb-2">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                  {t("llm.appliedDone")}
                </div>
              )}

              {/* v106 Phase D: 重複確認パネル */}
              {pendingPlan && pendingPlan.dups.length > 0 ? (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30 p-3 mb-2 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle size={13} />
                    {lf("llm.dupTitle", { n: pendingPlan.dups.length })}
                  </div>
                  <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
                    {t("llm.dupDesc")}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPendingPlan(p => p && ({ ...p, dups: p.dups.map(d => ({ ...d, accept: true })) }))}
                      className="text-[10px] px-2 py-0.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-100"
                    >{t("llm.dupAddAll")}</button>
                    <button
                      onClick={() => setPendingPlan(p => p && ({ ...p, dups: p.dups.map(d => ({ ...d, accept: false })) }))}
                      className="text-[10px] px-2 py-0.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-100"
                    >{t("llm.dupSkipAll")}</button>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1 border-t border-amber-200 dark:border-amber-800 pt-1.5">
                    {pendingPlan.dups.map((d, i) => (
                      <label key={i} className="flex items-start gap-2 text-[11px] cursor-pointer hover:bg-amber-100/50 rounded px-1 py-0.5">
                        <input
                          type="checkbox"
                          checked={d.accept}
                          onChange={e => setPendingPlan(p => {
                            if (!p) return p;
                            const dups = [...p.dups];
                            dups[i] = { ...dups[i], accept: e.target.checked };
                            return { ...p, dups };
                          })}
                          className="w-3.5 h-3.5 mt-0.5 shrink-0"
                        />
                        <span>
                          <span className="text-muted-foreground">{d.date.slice(5).replace("-", "/")}</span>{" "}
                          <strong>{d.newEvent.title}</strong>
                          <span className="text-amber-700/70 dark:text-amber-400/70">{lf("llm.dupExisting", { title: d.existingTitle })}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="gap-1.5 text-xs" onClick={applyPendingPlan}>
                      <Upload size={12} />{t("llm.dupConfirmAppend")}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => setPendingPlan(null)}>
                      {t("llm.cancel")}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {lf("llm.dupAutoAdd", { n: Object.values(pendingPlan.autoEventOpsBySem).reduce((s, a) => s + a.length, 0) })}
                  </p>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={handleImport}
                  disabled={!importJson.trim()}
                >
                  <Upload size={12} />
                  {t("llm.apply")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ヒント */}
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
            <ChevronRight size={12} className="mt-0.5 shrink-0" />
            <span>
              <strong>{t("llm.hintLabel")}</strong>{t("llm.hintBody")}
              {activeMode === "schedule" && t("llm.hintSchedule")}
            </span>
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
            {t("llm.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
