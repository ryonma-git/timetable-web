// 年間指導計画「取得ブラウザ」クライアント。
// バックエンド(/api/refresh/*)経由で改訂チェックエンジン(scripts/refresh_teaching_plans.py)
// を起動し、社×教科の取得状態を取得する。CLI不要。
//
// API が無い環境（静的配信のみ等）では available=false を返し、UI は
// 「この環境では取得を実行できません」と案内する（公開デモでの誤操作防止）。

export type RefreshMethod = "auto" | "browser" | "login" | "school_request";

// status:
//   auto系   … unchanged(変更なし) / changed(変更あり) / fetch_fail(取得失敗) / no_url(URL未登録) / unknown(未チェック)
//   それ以外 … login / school_request / browser（=要対応）
export type RefreshStatus =
  | "unchanged" | "changed" | "fetch_fail" | "no_url" | "unknown"
  | "login" | "school_request" | "browser";

export interface RefreshCard {
  level: string;
  source: string;
  subject: string;
  method: RefreshMethod;
  methodLabel: string;
  status: RefreshStatus;
  haveGrades: number[];
  changedGrades: number[];
  missingGrades: number[];
  recurring: boolean;
  userAction: string;
  actionKind: "login" | "open" | null;
  actionUrl: string | null;
  note: string;
}

export interface RefreshValidation {
  source: string;
  subject: string;
  grade: string;
  periods: number;
  expected: number;
  flag: string;
}

export interface RefreshState {
  generatedAt?: string | null;
  hasBaseline: boolean;
  levels: string[];
  validation: RefreshValidation[];
  cards: RefreshCard[];
}

const API = "/api/refresh";

async function getJson(pathname: string, timeoutMs = 200_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/${pathname}`, { signal: ctrl.signal, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (body as { error?: string }).error || `HTTP ${res.status}`;
      throw new Error(err === "engine_unavailable" ? "engine_unavailable" : err);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** バックエンドの取得エンジンが使えるか。 */
export async function refreshApiAvailable(): Promise<boolean> {
  try {
    const r = (await getJson("health", 5000)) as { ok?: boolean };
    return !!r.ok;
  } catch {
    return false;
  }
}

/** 直近の状態を取得（ネットには出ない）。 */
export async function getRefreshState(): Promise<RefreshState> {
  return (await getJson("sources")) as RefreshState;
}

/** 本年度取得＝配布元を再取得して改訂検知し、最新状態を返す（数十秒かかる）。 */
export async function runRefreshCheck(): Promise<RefreshState> {
  return (await getJson("run")) as RefreshState;
}

// ─── 表示用ヘルパ ─────────────────────────────────────────────
export interface StatusStyle {
  label: string;
  tone: "ok" | "warn" | "info" | "action" | "muted";
  icon: string;
}

export function statusStyle(c: RefreshCard): StatusStyle {
  switch (c.status) {
    case "unchanged":
      return { label: "変更なし", tone: "ok", icon: "✓" };
    case "changed":
      return { label: "変更あり", tone: "warn", icon: "⚠" };
    case "fetch_fail":
      return { label: "取得失敗", tone: "warn", icon: "?" };
    case "no_url":
      return { label: "未チェック(URL未登録)", tone: "muted", icon: "•" };
    case "login":
      return { label: "ログインが必要", tone: "action", icon: "🔒" };
    case "school_request":
      return { label: "学校から請求", tone: "action", icon: "🏫" };
    case "browser":
      return { label: "ブラウザ操作", tone: "info", icon: "🌐" };
    default:
      return { label: "未チェック", tone: "muted", icon: "•" };
  }
}
