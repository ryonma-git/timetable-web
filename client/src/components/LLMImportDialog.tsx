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
import type { OverrideOp, DailyEvent } from "@/lib/timetable";
import { nanoid } from "nanoid";

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

type ScheduleScope = "events_only" | "with_ops";
type ScheduleMode = "append" | "overwrite";

interface DupCandidate {
  date: string;
  newEvent: DailyEvent;
  existingTitle: string;
  accept: boolean; // true=追加する / false=スキップ
}

interface PendingPlan {
  dups: DupCandidate[];
  autoEventOps: OverrideOp[];   // 重複なしで自動追加するadd_day_event
  removeOps: OverrideOp[];      // 上書き時の既存削除
  classOps: OverrideOp[];       // コマ削除等（scopeがwith_opsのとき）
  eventsTotal: number;
  opsTotal: number;
}

export function LLMImportDialog({ open, onOpenChange, mode = "timetable" }: LLMImportDialogProps) {
  const { semester, updateSettings, applyOps, effectiveEntries } = useTimetable();
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

  const handleCopyPrompt = async () => {
    let prompt: string;
    if (activeMode === "timetable") prompt = generateTimetablePrompt(semester);
    else if (activeMode === "period_times") prompt = generatePeriodTimesPrompt();
    else prompt = generateSchedulePrompt(semester, userRules);
    await copyToClipboard(prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleImport = useCallback(() => {
    setParseError(null);
    setImportSuccess(false);

    if (!importJson.trim()) {
      setParseError("JSONを貼り付けてください。");
      return;
    }

    if (activeMode === "timetable") {
      // 時間割インポートはPatchImportDialogへ誘導（複雑なため）
      // ここでは簡易パース確認のみ
      try {
        JSON.parse(importJson);
        toast.info("時間割JSONを確認しました。「インポート」ボタン（ツールバー）からパッチインポートで読み込んでください。");
        setImportSuccess(true);
      } catch {
        setParseError("JSONの形式が正しくありません。LLMの出力をそのままコピーしてください。");
      }
    } else if (activeMode === "period_times") {
      const result = parsePeriodTimesJSON(importJson);
      if (!result) {
        setParseError("時程表JSONの形式が正しくありません。LLMの出力をそのままコピーしてください。");
        return;
      }
      const newSemester = {
        ...semester,
        ...(result.periodTimes ? { periodTimes: result.periodTimes } : {}),
        ...(result.periodTimesByDay ? { periodTimesByDay: result.periodTimesByDay } : {}),
      };
      updateSettings(newSemester);
      toast.success("時程表を更新しました。");
      setImportSuccess(true);
      setImportJson("");
    } else {
      // schedule mode (v106 Phase D: スコープ/モード/重複チェック)
      const parsed = parseScheduleJSON(importJson);
      if (!parsed) {
        setParseError("年間予定表JSONの形式が正しくありません。events配列またはops配列を含むJSONをコピーしてください。");
        return;
      }

      // スコープ: 予定欄だけ → コマ削除ops(parsed.ops)は無視
      const classOps: OverrideOp[] = scheduleScope === "with_ops" ? parsed.ops : [];

      // 既存の日次イベント（重複チェック・上書き範囲クリア用）
      const existing: Array<{ date: string; id: string; title: string }> = [];
      for (const e of effectiveEntries) {
        for (const ev of e.dayEvents ?? []) {
          existing.push({ date: e.date, id: ev.id, title: ev.title });
        }
      }

      if (parsed.events.length === 0 && classOps.length === 0) {
        setParseError("適用すべき予定・操作が見つかりませんでした。");
        return;
      }

      if (scheduleMode === "overwrite") {
        // 上書き: 全クリア or 取込日付範囲のみクリア
        let targets = existing;
        if (!overwriteAll && parsed.events.length > 0) {
          const dates = parsed.events.map(e => e.date).sort();
          const minD = dates[0], maxD = dates[dates.length - 1];
          targets = existing.filter(x => x.date >= minD && x.date <= maxD);
        }
        const removeOps: OverrideOp[] = targets.map(x => ({
          id: nanoid(8), op: "remove_day_event" as const, date: x.date, event_id: x.id,
        }));
        const addOps: OverrideOp[] = parsed.events.map(({ date, event }) => ({
          id: nanoid(8), op: "add_day_event" as const, date, event,
        }));
        applyOps([...removeOps, ...addOps, ...classOps], "年間予定表LLMインポート（上書き）");
        const msgs: string[] = [];
        if (parsed.events.length > 0) msgs.push(`${parsed.events.length}件の予定で置換`);
        if (removeOps.length > 0) msgs.push(`旧${removeOps.length}件削除`);
        if (classOps.length > 0) msgs.push(`${classOps.length}件の授業変更`);
        toast.success(msgs.join("・"));
        setImportSuccess(true);
        setImportJson("");
        return;
      }

      // 追記: 重複チェック（同一日付・正規化部分一致）
      const dups: DupCandidate[] = [];
      const autoEventOps: OverrideOp[] = [];
      for (const { date, event } of parsed.events) {
        const hit = existing.find(x => x.date === date && isDuplicateTitle(x.title, event.title));
        if (hit) {
          dups.push({ date, newEvent: event, existingTitle: hit.title, accept: false });
        } else {
          autoEventOps.push({ id: nanoid(8), op: "add_day_event", date, event });
        }
      }

      if (dups.length > 0) {
        // 確認ダイアログで個別選択
        setPendingPlan({
          dups, autoEventOps, removeOps: [], classOps,
          eventsTotal: parsed.events.length, opsTotal: classOps.length,
        });
        return;
      }

      // 重複なし → そのまま適用
      const allOps = [...autoEventOps, ...classOps];
      applyOps(allOps, "年間予定表LLMインポート（追記）");
      const msgs: string[] = [];
      if (autoEventOps.length > 0) msgs.push(`${autoEventOps.length}件の予定を追記`);
      if (classOps.length > 0) msgs.push(`${classOps.length}件の授業変更`);
      toast.success(msgs.join("・") || "適用しました");
      setImportSuccess(true);
      setImportJson("");
    }
  }, [activeMode, importJson, semester, updateSettings, applyOps, effectiveEntries, scheduleScope, scheduleMode, overwriteAll]);

  // v106 Phase D: 重複確認ダイアログから最終適用
  const applyPendingPlan = useCallback(() => {
    if (!pendingPlan) return;
    const dupAddOps: OverrideOp[] = pendingPlan.dups
      .filter(d => d.accept)
      .map(d => ({ id: nanoid(8), op: "add_day_event" as const, date: d.date, event: d.newEvent }));
    const all = [...pendingPlan.autoEventOps, ...dupAddOps, ...pendingPlan.classOps];
    if (all.length === 0) {
      toast.info("追加する予定がありませんでした");
      setPendingPlan(null);
      return;
    }
    applyOps(all, "年間予定表LLMインポート（追記・重複確認済み）");
    const added = pendingPlan.autoEventOps.length + dupAddOps.length;
    const skipped = pendingPlan.dups.length - dupAddOps.length;
    toast.success(`${added}件追記${skipped > 0 ? `・${skipped}件スキップ` : ""}${pendingPlan.classOps.length > 0 ? `・${pendingPlan.classOps.length}件の授業変更` : ""}`);
    setPendingPlan(null);
    setImportSuccess(true);
    setImportJson("");
  }, [pendingPlan, applyOps]);

  const modeConfig = {
    timetable: {
      icon: <FileJson size={13} />,
      label: "時間割",
      desc: "週間時間割の画像からクラス配置を読み取ります。",
      templateName: "timetable_template.json",
      importPlaceholder: "LLMが出力したJSONをここに貼り付けてください...",
      importNote: "※ 時間割JSONはパッチインポート（ツールバー「インポート」）で適用してください。",
    },
    period_times: {
      icon: <Clock size={13} />,
      label: "時程表",
      desc: "時程表の画像から各コマの開始・終了時刻を読み取ります。",
      templateName: "period_times_template.json",
      importPlaceholder: "LLMが出力した時程表JSONをここに貼り付けてください...",
      importNote: "「適用」ボタンを押すと時程表が更新されます。",
    },
    schedule: {
      icon: <Calendar size={13} />,
      label: "年間予定表",
      desc: "年間予定表の画像から行事・休講情報を読み取り、時間割に適用します。",
      templateName: "schedule_template.json",
      importPlaceholder: "LLMが出力した年間予定表JSONをここに貼り付けてください...",
      importNote: "「適用」ボタンを押すと行事・休講情報が時間割に反映されます。",
    },
  };

  const cfg = modeConfig[activeMode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot size={18} className="text-primary" />
            LLM連携で画像から読み取る
          </DialogTitle>
          <DialogDescription className="text-xs">
            ChatGPT・Claude等のLLMを使って、時間割・時程表・年間予定表の画像から自動でデータを入力できます。
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
              <p className="text-xs font-medium mb-1">取込スコープ</p>
              <div className="flex gap-2">
                {([["events_only", "予定欄だけ", "授業コマは一切変更しない（安全）"], ["with_ops", "コマ削除等も含む", "ルールに基づき授業もカット"]] as const).map(([v, label, desc]) => (
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
              <p className="text-xs font-medium mb-1">取込モード</p>
              <div className="flex gap-2">
                {([["append", "追記", "既存予定を残し追加（重複確認あり）"], ["overwrite", "上書き", "取込日付範囲の予定を置換"]] as const).map(([v, label, desc]) => (
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
            {scheduleMode === "overwrite" && (
              <label className="flex items-center gap-2 text-xs cursor-pointer pt-0.5">
                <input type="checkbox" checked={overwriteAll}
                  onChange={e => setOverwriteAll(e.target.checked)} className="w-3.5 h-3.5" />
                <span>既存予定を<strong>全クリア</strong>してから総入れ替え（日付範囲に限定しない）</span>
              </label>
            )}
            <p className="text-[10px] text-muted-foreground/70">
              {scheduleScope === "events_only"
                ? "✓ 授業コマは保護されます。予定欄のみ更新。"
                : "⚠ ルール該当行事は授業コマも削除されます。"}
              {scheduleMode === "append" ? " 追記＝既存を消さず追加。" : overwriteAll ? " 上書き＝既存を全削除して総入替。" : " 上書き＝取込日付範囲の既存予定のみ置換（範囲外は保持）。"}
            </p>
          </div>
        )}

        {/* 手順 */}
        <div className="space-y-3">
          {/* Step 1: テンプレート取得 */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">1</div>
              <div className="w-px flex-1 bg-border mt-1" />
            </div>
            <div className="pb-3 flex-1">
              <p className="text-sm font-medium mb-0.5">JSONテンプレートを取得</p>
              <p className="text-xs text-muted-foreground mb-2">空のJSONテンプレートをダウンロードまたはコピーします。</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleDownloadTemplate}>
                  <Download size={12} />ダウンロード
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleCopyTemplate}>
                  {copiedTemplate ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                  {copiedTemplate ? "コピー済み" : "コピー"}
                </Button>
              </div>
            </div>
          </div>

          {/* Step 2: ルール入力（年間予定表モードのみ） */}
          {activeMode === "schedule" && (
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">2</div>
                <div className="w-px flex-1 bg-border mt-1" />
              </div>
              <div className="pb-3 flex-1">
                <p className="text-sm font-medium mb-0.5">個別ルールを入力（任意）</p>
                <p className="text-xs text-muted-foreground mb-2">
                  行事ごとの休講ルールをLLMに伝えます。例：「運動会は全コマ休講」「校外学習は4限まで授業なし、5・6限は授業あり」
                </p>
                <Textarea
                  value={userRules}
                  onChange={(e) => setUserRules(e.target.value)}
                  placeholder="例: 運動会は全コマ休講。校外学習は4限まで授業なし、5・6限は授業あり。..."
                  className="text-xs min-h-[60px] resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 2/3: プロンプトコピー */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {activeMode === "schedule" ? "3" : "2"}
              </div>
              <div className="w-px flex-1 bg-border mt-1" />
            </div>
            <div className="pb-3 flex-1">
              <p className="text-sm font-medium mb-0.5">LLM向けプロンプトをコピー</p>
              <p className="text-xs text-muted-foreground mb-2">ChatGPT・Claude等に渡すプロンプトをコピーします。</p>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleCopyPrompt}>
                {copiedPrompt ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                {copiedPrompt ? "コピー済み" : "プロンプトをコピー"}
              </Button>
            </div>
          </div>

          {/* Step 3/4: LLMに渡す */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {activeMode === "schedule" ? "4" : "3"}
              </div>
              <div className="w-px flex-1 bg-border mt-1" />
            </div>
            <div className="pb-3 flex-1">
              <p className="text-sm font-medium mb-0.5">LLMに画像とテンプレートを渡す</p>
              <p className="text-xs text-muted-foreground">
                ChatGPT・Claude等を開き、「プロンプト」「JSONテンプレート」「画像」を一緒に貼り付けて送信します。
              </p>
            </div>
          </div>

          {/* Step 4/5: JSONを貼り付けてインポート */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {activeMode === "schedule" ? "5" : "4"}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium mb-0.5">LLMが返したJSONを貼り付けて適用</p>
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
                  適用しました。
                </div>
              )}

              {/* v106 Phase D: 重複確認パネル */}
              {pendingPlan && pendingPlan.dups.length > 0 ? (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30 p-3 mb-2 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle size={13} />
                    重複の可能性がある予定が {pendingPlan.dups.length} 件あります
                  </div>
                  <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
                    同じ日付に似た予定が既にあります。チェックを入れたものだけ追加します（重複は既定でスキップ）。
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPendingPlan(p => p && ({ ...p, dups: p.dups.map(d => ({ ...d, accept: true })) }))}
                      className="text-[10px] px-2 py-0.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-100"
                    >すべて追加</button>
                    <button
                      onClick={() => setPendingPlan(p => p && ({ ...p, dups: p.dups.map(d => ({ ...d, accept: false })) }))}
                      className="text-[10px] px-2 py-0.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-100"
                    >すべてスキップ</button>
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
                          <span className="text-amber-700/70 dark:text-amber-400/70"> ↔ 既存「{d.existingTitle}」</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="gap-1.5 text-xs" onClick={applyPendingPlan}>
                      <Upload size={12} />確定して追記
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => setPendingPlan(null)}>
                      キャンセル
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    重複なしの {pendingPlan.autoEventOps.length} 件は自動追加されます。
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
                  適用する
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
              <strong>ヒント:</strong> GPT-4o・Claude 3.5 Sonnet等の画像対応モデルを使うと精度が上がります。
              読み取り結果は必ず確認してから保存してください。
              {activeMode === "schedule" && " 年間予定表は複雑なため、適用後に変更履歴で内容を確認することをお勧めします。"}
            </span>
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
