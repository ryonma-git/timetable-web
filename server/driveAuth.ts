// Google Drive の「都度ログイン」を解消するための、サーバー側トークン維持。
//
// 従来（GIS/ブラウザ完結）は access_token のみでリフレッシュトークンを持てず、
// 約1時間で失効するたびに再ログインが要る。
// ここでは authorization code フロー（access_type=offline）でリフレッシュトークンを
// 一度だけ取得し、以後はサーバーが黙って更新する。ユーザーの初回ログインは1回で済む。
//
// 既存の GIS ログイン（googleDrive.ts）はそのまま残す。フォールバックとして機能する。
//
// 必須の環境変数（未設定なら 503 を返し、既存のGISログインのみで動作）:
//   GOOGLE_CLIENT_ID      … 既存クライアントと同じ値でよい
//   GOOGLE_CLIENT_SECRET  … Google Cloud Console で新規発行が必要（後述）
//
// セットアップ手順（一度だけ・ユーザー操作が必要）:
//   1. https://console.cloud.google.com/apis/credentials で既存のOAuthクライアント
//      （クライアントID: 693809505459-...）を開く。
//   2. 種類が「ウェブ アプリケーション」であることを確認。
//   3. 「承認済みのリダイレクト URI」に以下を追加:
//        http://ryon-book-m5pro:3000/api/drive/callback
//        http://localhost:3000/api/drive/callback   （このMacで開発する場合）
//   4. 「クライアント シークレット」を発行し、環境変数 GOOGLE_CLIENT_SECRET に設定
//      （LaunchAgent の plist の EnvironmentVariables に追記するのが簡単）。
//   5. アプリの「スマホ連動」設定などから「サーバー経由でログイン」を実行（別途UI予定）。

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

function dataDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.env.SYNC_DATA_DIR || path.join(dir, ".sync-data");
}

const TOKEN_FILE = () => path.join(dataDir(), "drive-refresh-token.json");

interface StoredToken {
  refresh_token: string;
  savedAt: string;
}

// authorization code フロー用の一時 state（CSRF対策・callbackに認証ヘッダを付けられないため）
const pendingStates = new Map<string, number>(); // state -> 発行時刻(ms)
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupStates() {
  const now = Date.now();
  pendingStates.forEach((t, s) => {
    if (now - t > STATE_TTL_MS) pendingStates.delete(s);
  });
}

export function driveAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function hasStoredRefreshToken(): boolean {
  return fs.existsSync(TOKEN_FILE());
}

export function buildAuthUrl(redirectUri: string): { url: string; state: string } {
  cleanupStates();
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline", // ★これでリフレッシュトークンがもらえる
    prompt: "consent", // 毎回 refresh_token を確実にもらうため
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state };
}

export async function handleCallback(
  code: string,
  state: string,
  redirectUri: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  cleanupStates();
  if (!pendingStates.has(state)) {
    return { ok: false, error: "state が無効です（時間切れ、または不正なアクセス）" };
  }
  pendingStates.delete(state);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `トークン交換に失敗しました (HTTP ${res.status}): ${await res.text()}` };
  }
  const json = (await res.json()) as { refresh_token?: string; error?: string };
  if (!json.refresh_token) {
    // 既に一度 consent 済みだと refresh_token が返らないことがある。
    // prompt=consent を付けているので通常は発行されるはず。
    return {
      ok: false,
      error: "refresh_token が発行されませんでした。Googleアカウントの連携済みアプリ一覧から一度アクセスを削除し、やり直してください。",
    };
  }
  const dir = dataDir();
  await fsp.mkdir(dir, { recursive: true });
  const stored: StoredToken = { refresh_token: json.refresh_token, savedAt: new Date().toISOString() };
  await fsp.writeFile(TOKEN_FILE(), JSON.stringify(stored), "utf-8");
  return { ok: true };
}

// メモリ上に短命キャッシュ（毎リクエストGoogleを叩かない）
let cached: { access_token: string; expiresAt: number } | null = null;

export async function getServerAccessToken(): Promise<
  { ok: true; access_token: string; expires_in: number } | { ok: false; error: string }
> {
  if (!driveAuthConfigured()) return { ok: false, error: "not_configured" };
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return { ok: true, access_token: cached.access_token, expires_in: Math.floor((cached.expiresAt - Date.now()) / 1000) };
  }
  let stored: StoredToken;
  try {
    stored = JSON.parse(await fsp.readFile(TOKEN_FILE(), "utf-8"));
  } catch {
    return { ok: false, error: "not_linked" };
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: stored.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `refresh_failed (HTTP ${res.status})` };
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { access_token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return { ok: true, access_token: json.access_token, expires_in: json.expires_in };
}

export async function unlink(): Promise<void> {
  cached = null;
  await fsp.unlink(TOKEN_FILE()).catch(() => {});
}
