// 時間割スナップショット同期API（express / Vite dev の双方から使う共通ハンドラ）。
//
// エンドポイント（/api/sync 配下）:
//   GET  /api/sync/health           → {ok, kind, hasSnapshot, version}
//   GET  /api/sync/snapshot         → {version, updatedAt, savedAt, payload} / 204
//   PUT  /api/sync/snapshot         ← {payload, updatedAt, baseVersion?, device?} → {version} / 409
//   GET  /api/sync/versions         → [{version, updatedAt, savedAt, device}]
//   GET  /api/sync/bootstrap-token  → {token}  ※localhost からのみ（Macの自動設定用）
//
// 認証: ヘッダ x-sync-token が一致必須（health / bootstrap を除く）。
// トークンは env SYNC_TOKEN、無ければ .sync-data/token.txt を自動生成して使う。
// E2E は今回入れない（payload 平文）。将来 payload を暗号文にしても本APIは無改修。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSyncStore } from "./syncStore";

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
  if (_token) return _token;
  if (process.env.SYNC_TOKEN) {
    _token = process.env.SYNC_TOKEN;
    return _token;
  }
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const tf = path.join(dir, "token.txt");
  try {
    _token = fs.readFileSync(tf, "utf-8").trim();
    if (_token) return _token;
  } catch {
    /* generate below */
  }
  _token = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(tf, _token, "utf-8");
  // eslint-disable-next-line no-console
  console.log(`[sync] 同期トークンを生成しました（.sync-data/token.txt）: ${_token}`);
  return _token;
}

export interface SyncRequest {
  method: string;
  pathname: string; // /api/sync 以降を含む正規化済みパス（例 /snapshot）
  token: string | null; // x-sync-token ヘッダ
  isLocal: boolean; // リクエスト元がループバックか
  body: () => Promise<unknown>; // JSONボディ取得（PUT時）
}

export interface SyncResponse {
  status: number;
  json: unknown;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function handleSync(req: SyncRequest): Promise<SyncResponse> {
  const p = req.pathname.replace(/\/+$/, "") || "/";
  const store = getSyncStore();

  // --- 認証不要 ---
  if (req.method === "GET" && p.endsWith("/health")) {
    const cur = await store.get();
    return {
      status: 200,
      json: { ok: true, kind: store.kind, hasSnapshot: !!cur, version: cur?.version ?? 0 },
    };
  }
  // Mac（同一マシン）だけがトークンを自動取得できる。スマホは手入力。
  if (req.method === "GET" && p.endsWith("/bootstrap-token")) {
    if (!req.isLocal) return { status: 403, json: { error: "local_only" } };
    return { status: 200, json: { token: syncToken() } };
  }

  // --- ここから要認証 ---
  if (!req.token || !timingSafeEqual(req.token, syncToken())) {
    return { status: 401, json: { error: "unauthorized" } };
  }

  if (req.method === "GET" && p.endsWith("/snapshot")) {
    const cur = await store.get();
    if (!cur) return { status: 204, json: null };
    return {
      status: 200,
      json: {
        version: cur.version,
        updatedAt: cur.updatedAt,
        savedAt: cur.savedAt,
        device: cur.device,
        payload: cur.payload,
      },
    };
  }

  if (req.method === "PUT" && p.endsWith("/snapshot")) {
    const body = (await req.body()) as {
      payload?: unknown;
      updatedAt?: string;
      baseVersion?: number | null;
      device?: string;
    } | null;
    if (!body || body.payload === undefined || !body.updatedAt) {
      return { status: 400, json: { error: "payload_and_updatedAt_required" } };
    }
    const r = await store.put({
      payload: body.payload,
      updatedAt: body.updatedAt,
      baseVersion: body.baseVersion ?? null,
      device: body.device,
    });
    if (!r.ok) {
      return {
        status: 409,
        json: { error: "conflict", serverVersion: r.serverVersion, updatedAt: r.updatedAt },
      };
    }
    return { status: 200, json: { version: r.version } };
  }

  if (req.method === "GET" && p.endsWith("/versions")) {
    return { status: 200, json: await store.listVersions() };
  }

  return { status: 404, json: { error: "not_found" } };
}

/** /api/sync 以降のパスを取り出す（mount前提のミドルウェアでは req.url が既に相対）。 */
export function normalizeSyncPath(url: string): string {
  const u = url.split("?")[0];
  const idx = u.indexOf("/api/sync");
  return idx >= 0 ? u.slice(idx + "/api/sync".length) || "/" : u || "/";
}
