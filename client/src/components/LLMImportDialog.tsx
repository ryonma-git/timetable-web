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
      const validCats = ["ceremony", "event", "meeting", "drill", "holiday", "other"];
      const category = typeof obj.category === "string" && validCats.includes(obj.category)
        ? obj.category as DailyEvent["category"]
        : "other";
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

export function LLMImportDialog({ open, onOpenChange, mode = "timetable" }: LLMImportDialogProps) {
  const { semester, updateSettings, applyOps } = useTimetable();
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [activeMode, setActiveMode] = useState<LLMImportMode>(mode);
  const [importJson, setImportJson] = useState("");
  const [userRules, setUserRules] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  // ダイアログが開くたびにmodeに合わせてactiveModeをリセット
  useEffect(() => {
    if (open) {
      setActiveMode(mode);
      setImportJson("");
      setParseError(null);
      setImportSuccess(false);
      setCopiedPrompt(false);
      setCopiedTemplate(false);
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
      // schedule mode (v91: events + ops 2層)
      const parsed = parseScheduleJSON(importJson);
      if (!parsed) {
        setParseError("年間予定表JSONの形式が正しくありません。events配列またはops配列を含むJSONをコピーしてください。");
        return;
      }
      // events を add_day_event op に変換
      const eventOps: OverrideOp[] = parsed.events.map(({ date, event }) => ({
        id: nanoid(8),
        op: "add_day_event" as const,
        date,
        event,
      }));
      // events → ops の順で適用（events先に入れて、後でopsで上書き/カット）
      const allOps = [...eventOps, ...parsed.ops];
      if (allOps.length === 0) {
        setParseError("適用すべきイベント・操作が見つかりませんでした。");
        return;
      }
      applyOps(allOps, "年間予定表LLMインポート");
      const msgs: string[] = [];
      if (parsed.events.length > 0) msgs.push(`${parsed.events.length}件の予定`);
      if (parsed.ops.length > 0) msgs.push(`${parsed.ops.length}件の授業変更`);
      toast.success(`${msgs.join("・")}を適用しました。`);
      setImportSuccess(true);
      setImportJson("");
    }
  }, [activeMode, importJson, semester, updateSettings, applyOps]);

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
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handleImport}
                disabled={!importJson.trim()}
              >
                <Upload size={12} />
                適用する
              </Button>
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
