// Google Drive サーバー経由ログインのAPI（server/driveAuth.ts のHTTPラッパー）。
//
// エンドポイント（/api/drive 配下）:
//   GET  /status         → {configured, linked}
//   GET  /auth-url        → {url}  ★x-sync-token 必須（同期と同じトークンを流用）
//   GET  /callback         ← Googleからのリダイレクト（?code&state）。認証ヘッダは付けられないため
//                            state で検証する。成功時は簡易HTMLで案内して自動で閉じる。
//   GET  /token            → {access_token, expires_in}  ★x-sync-token 必須
//   POST /unlink            ★x-sync-token 必須

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  driveAuthConfigured,
  hasStoredRefreshToken,
  buildAuthUrl,
  handleCallback,
  getServerAccessToken,
  unlink,
} from "./driveAuth";

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

let _token: string | null = null;
function syncToken(): string {
  // /api/sync と同じトークンファイルを共有する（利用者から見て「1つのトークン」でよい）
  if (_token) return _token;
  const tf = path.join(dataDir(), "token.txt");
  try {
    _token = fs.readFileSync(tf, "utf-8").trim();
  } catch {
    /* まだ生成されていない（sync側が先に叩かれれば作られる） */
  }
  return _token || "";
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export interface DriveRequest {
  method: string;
  pathname: string; // /api/drive 以降（例 /auth-url）
  token: string | null;
  query: URLSearchParams;
  origin: string; // callback の redirect_uri 組み立てに使う（例 http://ryon-book-m5pro:3000）
}
export interface DriveResponse {
  status: number;
  json?: unknown;
  html?: string;
}

function requireAuth(req: DriveRequest): DriveResponse | null {
  const t = syncToken();
  if (!t || !req.token || !timingSafeEqual(req.token, t)) {
    return { status: 401, json: { error: "unauthorized" } };
  }
  return null;
}

export async function handleDriveApi(req: DriveRequest): Promise<DriveResponse> {
  const p = req.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && p.endsWith("/status")) {
    return {
      status: 200,
      json: { configured: driveAuthConfigured(), linked: hasStoredRefreshToken() },
    };
  }

  if (req.method === "GET" && p.endsWith("/auth-url")) {
    const denied = requireAuth(req);
    if (denied) return denied;
    if (!driveAuthConfigured()) return { status: 503, json: { error: "not_configured" } };
    const redirectUri = `${req.origin}/api/drive/callback`;
    const { url } = buildAuthUrl(redirectUri);
    return { status: 200, json: { url } };
  }

  if (req.method === "GET" && p.endsWith("/callback")) {
    const code = req.query.get("code");
    const state = req.query.get("state");
    if (!code || !state) {
      return { status: 400, html: page("エラー", "code または state がありません。") };
    }
    const redirectUri = `${req.origin}/api/drive/callback`;
    const r = await handleCallback(code, state, redirectUri);
    if (!r.ok) return { status: 400, html: page("連携に失敗しました", r.error) };
    return {
      status: 200,
      html: page(
        "連携できました",
        "このタブは閉じて構いません。アプリに戻ると自動的にログイン状態が維持されます。"
      ),
    };
  }

  if (req.method === "GET" && p.endsWith("/token")) {
    const denied = requireAuth(req);
    if (denied) return denied;
    const r = await getServerAccessToken();
    if (!r.ok) {
      const status = r.error === "not_linked" || r.error === "not_configured" ? 404 : 502;
      return { status, json: { error: r.error } };
    }
    return { status: 200, json: { access_token: r.access_token, expires_in: r.expires_in } };
  }

  if (req.method === "POST" && p.endsWith("/unlink")) {
    const denied = requireAuth(req);
    if (denied) return denied;
    await unlink();
    return { status: 200, json: { ok: true } };
  }

  return { status: 404, json: { error: "not_found" } };
}

export function normalizeDrivePath(url: string): string {
  const u = url.split("?")[0];
  const idx = u.indexOf("/api/drive");
  return idx >= 0 ? u.slice(idx + "/api/drive".length) || "/" : u || "/";
}

function page(title: string, message: string): string {
  return `<!doctype html><html lang="ja"><meta charset="utf-8">
<title>${title}</title>
<body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f8f8">
  <div style="text-align:center;max-width:24rem;padding:2rem">
    <h1 style="font-size:1.1rem">${title}</h1>
    <p style="color:#555;font-size:0.9rem">${message}</p>
  </div>
</body></html>`;
}
