// StatsView.tsx
// Design: Swiss Grid × Japanese Functional Design
// Stats, history, and audit log views

import { useTimetable } from "@/contexts/TimetableContext";
import { ClassStats, todayISO } from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";

// ─── Stats View ───────────────────────────────────────────────

export function StatsView() {
  const { classStats, asOfDate, setAsOfDate, isLoaded } = useTimetable();

  if (!isLoaded) {
    return <EmptyState message="ZIPファイルを読み込むと集計が表示されます" />;
  }

  const gradeGroups: Record<string, ClassStats[]> = {};
  for (const s of classStats) {
    if (!gradeGroups[s.grade]) gradeGroups[s.grade] = [];
    gradeGroups[s.grade].push(s);
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* as_of date picker */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">集計基準日</Label>
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
          今日に戻す
        </button>
        <span className="text-xs text-muted-foreground">
          ※ この日付以前を「実施済み」として集計します
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          {
            label: "総コマ数",
            value: classStats.reduce((s, c) => s + c.totalPeriods, 0),
            color: "text-foreground",
            bg: "bg-muted/50",
          },
          {
            label: "実施済み",
            value: classStats.reduce((s, c) => s + c.completedPeriods, 0),
            color: "text-emerald-700",
            bg: "bg-emerald-50",
          },
          {
            label: "残り",
            value: classStats.reduce((s, c) => s + c.remainingPeriods, 0),
            color: "text-amber-700",
            bg: "bg-amber-50",
          },
        ].map(card => (
          <div key={card.label} className={cn("rounded-lg p-3 border border-border", card.bg)}>
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={cn("text-2xl font-bold tabular-nums", card.color)}>{card.value}</p>
            <p className="text-[10px] text-muted-foreground">コマ</p>
          </div>
        ))}
      </div>

      {/* Grade groups */}
      {Object.entries(gradeGroups).sort().map(([grade, stats]) => (
        <div key={grade} className="mb-6">
          <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
            <span className={cn(
              "w-2 h-2 rounded-full",
              grade === "4年" ? "bg-blue-400" :
              grade === "5年" ? "bg-emerald-400" : "bg-violet-400"
            )} />
            {grade}
          </h3>
          <div className="space-y-2">
            {stats.map(s => (
              <ClassStatRow key={s.class} stat={s} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ClassStatRow({ stat }: { stat: ClassStats }) {
  const pct = Math.round(stat.completionRate * 100);
  const gradeColor =
    stat.grade === "4年" ? "bg-blue-400" :
    stat.grade === "5年" ? "bg-emerald-400" : "bg-violet-400";

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{stat.class}</span>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground">計 <span className="font-bold text-foreground">{stat.totalPeriods}</span></span>
          <span className="text-emerald-600">済 <span className="font-bold">{stat.completedPeriods}</span></span>
          <span className="text-amber-600">残 <span className="font-bold">{stat.remainingPeriods}</span></span>
          <span className="text-muted-foreground font-medium">{pct}%</span>
        </div>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", gradeColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── History View ─────────────────────────────────────────────

export function HistoryView() {
  const { undoStack, undo, isLoaded } = useTimetable();

  if (!isLoaded) {
    return <EmptyState message="ZIPファイルを読み込むと変更履歴が表示されます" />;
  }

  if (undoStack.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
        <Info size={24} className="text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">変更履歴はまだありません</p>
        <p className="text-xs text-muted-foreground/60">授業変更を行うと、ここに履歴が表示されます</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">変更履歴</h2>
        <span className="text-xs text-muted-foreground">{undoStack.length}件</span>
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
                  {new Date(entry.timestamp).toLocaleString("ja-JP")}
                  {" · "}{entry.ops.length}件の操作
                </p>
              </div>
              {i === 0 && (
                <button
                  onClick={undo}
                  className="text-[10px] text-primary hover:underline shrink-0"
                >
                  元に戻す
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

  if (!isLoaded) {
    return <EmptyState message="ZIPファイルを読み込むと適用ログが表示されます" />;
  }

  const warns = auditLog.filter(a => a.level === "warn").length;
  const errors = auditLog.filter(a => a.level === "error").length;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">適用ログ</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{auditLog.length}件</span>
          {warns > 0 && <span className="text-amber-600 font-medium">警告 {warns}件</span>}
          {errors > 0 && <span className="text-red-600 font-medium">エラー {errors}件</span>}
        </div>
      </div>

      {auditLog.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">ログはありません</p>
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
                    {entry.date}{entry.period ? ` ${entry.period}限` : ""}
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
