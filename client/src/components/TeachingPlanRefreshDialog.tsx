// 年間指導計画「取得ブラウザ」ダイアログ（拡張版機能）
// アプリ内から CLI なしで改訂チェックエンジンを起動し、社×教科ごとに
//   取得中 / 変更なし / 変更あり / ログインが必要[ログイン] / 学校から請求 / ブラウザ操作
// を表示する。校種(小学校/中学校)切替に対応（中学は今後追加）。
//
// 設計: docs/teaching-plan-refresh.md / scripts/refresh_teaching_plans.py

import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, ExternalLink, LogIn, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getRefreshState, runRefreshCheck, refreshApiAvailable, statusStyle,
  type RefreshState, type RefreshCard,
} from "@/lib/teachingPlanRefresh";

interface Props {
  open: boolean;
  onClose: () => void;
}

const toneClass: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  action: "bg-rose-50 text-rose-700 border-rose-200",
  muted: "bg-muted text-muted-foreground border-border",
};

export function TeachingPlanRefreshDialog({ open, onClose }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<RefreshState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<string>("小学校");

  const load = useCallback(async () => {
    setError(null);
    const ok = await refreshApiAvailable();
    setAvailable(ok);
    if (!ok) return;
    try {
      setState(await getRefreshState());
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, []);

  useEffect(() => {
    if (open) {
      setState(null);
      setAvailable(null);
      void load();
    }
  }, [open, load]);

  const onRun = async () => {
    setRunning(true);
    setError(null);
    // 体感のため、auto 社はまず「取得中」に見せる
    setState((s) =>
      s ? { ...s, cards: s.cards.map((c) => (c.method === "auto" ? { ...c, status: "unknown" } : c)) } : s
    );
    try {
      setState(await runRefreshCheck());
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setRunning(false);
    }
  };

  const levels = state?.levels?.length ? state.levels : ["小学校"];
  const cards = useMemo(
    () => (state?.cards ?? []).filter((c) => c.level === level),
    [state, level]
  );
  const bySubject = useMemo<[string, RefreshCard[]][]>(() => {
    const m = new Map<string, RefreshCard[]>();
    for (const c of cards) {
      const arr = m.get(c.subject) ?? [];
      arr.push(c);
      m.set(c.subject, arr);
    }
    return Array.from(m.entries());
  }, [cards]);

  const counts = useMemo(() => {
    const c = { changed: 0, action: 0, ok: 0 };
    for (const card of cards) {
      if (card.status === "changed") c.changed++;
      else if (["login", "school_request", "browser"].includes(card.status)) c.action++;
      else if (card.status === "unchanged") c.ok++;
    }
    return c;
  }, [cards]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            年間指導計画 取得ブラウザ
          </DialogTitle>
        </DialogHeader>

        {/* 校種タブ */}
        <div className="flex items-center gap-2">
          {levels.map((lv) => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              className={cn(
                "px-3 py-1 rounded-full text-sm border transition",
                lv === level ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
              )}
            >
              {lv}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {state?.generatedAt ? `最終チェック: ${state.generatedAt}` : "未チェック"}
          </span>
        </div>

        {/* 実行バー */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
          <Button onClick={onRun} disabled={running || available === false} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            本年度の取得を実行
          </Button>
          <div className="text-sm text-muted-foreground">
            {running
              ? "配布元を再取得して改訂を確認しています…"
              : `変更あり ${counts.changed} ／ 要対応 ${counts.action} ／ 変更なし ${counts.ok}`}
          </div>
        </div>

        {/* 本体 */}
        {available === false ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              この環境では取得エンジンを起動できません（取得ブラウザはローカル実行版／同梱サーバーで動作します）。
              公開版では Claude に「指導計画の改訂チェックを走らせて」と依頼してください。
            </div>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            エラー: {error}
          </div>
        ) : !state ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> 読み込み中…
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh] -mx-2 px-2">
            <div className="space-y-4 pb-2">
              {state.validation.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <div className="font-medium mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> 時数バリデーション（標準時数からの逸脱）
                  </div>
                  {state.validation.map((v, i) => (
                    <div key={i}>
                      {v.source} {v.subject}
                      {v.grade}: {v.periods}時（標準{v.expected}）{v.flag}
                    </div>
                  ))}
                </div>
              )}

              {bySubject.map(([subject, list]) => (
                <div key={subject}>
                  <div className="text-sm font-semibold mb-1.5 text-muted-foreground">{subject}</div>
                  <div className="space-y-1.5">
                    {list.map((c) => (
                      <CardRow key={c.source + c.subject} card={c} running={running} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardRow({ card, running }: { card: RefreshCard; running: boolean }) {
  const showRunning = running && card.method === "auto";
  const s = statusStyle(card);
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{card.source}</span>
          {card.haveGrades.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {card.haveGrades.join("・")}年
            </span>
          )}
          {card.missingGrades.length > 0 && (
            <span className="text-xs text-rose-600">★{card.missingGrades.join("・")}年が欠番</span>
          )}
          {card.recurring && (
            <span className="text-[10px] rounded bg-muted px-1 text-muted-foreground">毎年度再発</span>
          )}
        </div>
        {card.userAction && (
          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{card.userAction}</div>
        )}
        {card.status === "changed" && card.changedGrades.length > 0 && (
          <div className="mt-0.5 text-xs text-amber-700">
            {card.changedGrades.join("・")}年に変更を検知 → Claude に「{card.source}
            {card.subject}を再取得して差し替えて」と依頼
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
            showRunning ? toneClass.info : toneClass[s.tone]
          )}
        >
          {showRunning ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> 取得中
            </>
          ) : (
            <>
              <span>{s.icon}</span>
              {s.label}
            </>
          )}
        </span>

        {card.actionUrl && card.actionKind === "login" && (
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => open(card.actionUrl!)}>
            <LogIn className="h-3.5 w-3.5" /> ログイン
          </Button>
        )}
        {card.actionUrl && card.actionKind === "open" && (
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => open(card.actionUrl!)}>
            <ExternalLink className="h-3.5 w-3.5" /> サイトを開く
          </Button>
        )}
      </div>
    </div>
  );
}
