// 時間割スナップショット同期クライアント（自宅サーバ / Vercel 共通）。
//
// サーバ契約: /api/sync（server/syncApi.ts）。
//   GET  /health           認証不要
//   GET  /bootstrap-token   localhost(=Mac)のみ。トークン自動取得用
//   GET  /snapshot          x-sync-token 必須。{version, updatedAt, payload} / 204
//   PUT  /snapshot          x-sync-token 必須。{payload, updatedAt, baseVersion?} → {version} / 409
//
// 設計方針: E2Eは今回入れない（payload平文）。将来入れる時は push前に暗号化、
// pull後に復号する層をここに挟むだけにする（UI/Contextは無改修）。

import type { TimetableFile } from "./timetableFile";

const K = {
  enabled: "sync.enabled",
  serverUrl: "sync.serverUrl", // 空=同一オリジン（Macでアプリとサーバが同居する場合）
  token: "sync.token",
  baseVersion: "sync.baseVersion", // 直近にpush/pullで確認したサーバ版
  device: "sync.device",
};

export interface SyncConfig {
  enabled: boolean;
  serverUrl: string;
  token: string;
  device: string;
}

export function getSyncConfig(): SyncConfig {
  return {
    enabled: localStorage.getItem(K.enabled) === "1",
    serverUrl: localStorage.getItem(K.serverUrl) ?? "",
    token: localStorage.getItem(K.token) ?? "",
    device: localStorage.getItem(K.device) || defaultDeviceName(),
  };
}

export function setSyncConfig(patch: Partial<SyncConfig>): void {
  if (patch.enabled !== undefined) localStorage.setItem(K.enabled, patch.enabled ? "1" : "0");
  if (patch.serverUrl !== undefined) localStorage.setItem(K.serverUrl, patch.serverUrl.trim().replace(/\/$/, ""));
  if (patch.token !== undefined) localStorage.setItem(K.token, patch.token.trim());
  if (patch.device !== undefined) localStorage.setItem(K.device, patch.device.trim());
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/mac/i.test(ua)) return "Mac";
  if (/win/i.test(ua)) return "Windows";
  return "デバイス";
}

function base(): string {
  return getSyncConfig().serverUrl; // "" → 相対（同一オリジン）
}

function authHeaders(): Record<string, string> {
  const { token } = getSyncConfig();
  return token ? { "x-sync-token": token } : {};
}

export function getBaseVersion(): number {
  return Number(localStorage.getItem(K.baseVersion) || "0") || 0;
}
export function setBaseVersion(v: number): void {
  localStorage.setItem(K.baseVersion, String(v));
}

export interface SyncHealth {
  ok: boolean;
  kind?: string;
  hasSnapshot?: boolean;
  version?: number;
}

/** サーバ疎通確認（認証不要）。到達できなければ ok:false。 */
export async function syncHealth(): Promise<SyncHealth> {
  try {
    const res = await fetch(`${base()}/api/sync/health`, { cache: "no-store" });
    if (!res.ok) return { ok: false };
    return (await res.json()) as SyncHealth;
  } catch {
    return { ok: false };
  }
}

/** localhost(=Mac)のみ: サーバからトークンを自動取得して保存。成功=true。 */
export async function bootstrapToken(): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/api/sync/bootstrap-token`, { cache: "no-store" });
    if (!res.ok) return false;
    const { token } = (await res.json()) as { token?: string };
    if (token) {
      setSyncConfig({ token });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface RemoteSnapshot {
  version: number;
  updatedAt: string;
  savedAt?: string;
  device?: string;
  payload: TimetableFile;
}

/** サーバの最新を取得。未保存(204)は null。 */
export async function pullSnapshot(): Promise<RemoteSnapshot | null> {
  const res = await fetch(`${base()}/api/sync/snapshot`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.status === 204) return null;
  if (res.status === 401) throw new SyncError("unauthorized", "同期トークンが正しくありません");
  if (!res.ok) throw new SyncError("pull_failed", `取得に失敗しました (HTTP ${res.status})`);
  const d = (await res.json()) as RemoteSnapshot;
  setBaseVersion(d.version);
  return d;
}

export type PushResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; serverVersion: number; updatedAt: string };

/** ローカルのファイルをサーバへ送信。baseVersion 不一致なら競合(409)。 */
export async function pushSnapshot(file: TimetableFile): Promise<PushResult> {
  const cfg = getSyncConfig();
  const res = await fetch(`${base()}/api/sync/snapshot`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      payload: file,
      updatedAt: file.meta?.updatedAt ?? new Date().toISOString(),
      baseVersion: getBaseVersion(),
      device: cfg.device,
    }),
  });
  if (res.status === 401) throw new SyncError("unauthorized", "同期トークンが正しくありません");
  if (res.status === 409) {
    const d = (await res.json()) as { serverVersion: number; updatedAt: string };
    return { ok: false, conflict: true, serverVersion: d.serverVersion, updatedAt: d.updatedAt };
  }
  if (!res.ok) throw new SyncError("push_failed", `送信に失敗しました (HTTP ${res.status})`);
  const d = (await res.json()) as { version: number };
  setBaseVersion(d.version);
  return { ok: true, version: d.version };
}

/** 競合を last-write-wins で強制上書き（サーバ版に合わせてから再PUT）。 */
export async function forcePush(file: TimetableFile, serverVersion: number): Promise<PushResult> {
  setBaseVersion(serverVersion);
  return pushSnapshot(file);
}

export class SyncError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * サーバから受け取った payload が取り込み可能な時間割ファイルか検証する。
 * 壊れた/古い形式を loadTimetableFile に渡すと配列の map で例外になり、
 * 「未接続」と紛らわしい表示になるため、取り込む前にここで弾く。
 */
export function validateSnapshotPayload(p: unknown): { ok: true } | { ok: false; reason: string } {
  if (!p || typeof p !== "object") return { ok: false, reason: "データが空です" };
  const f = p as Partial<TimetableFile> & { semesters?: unknown };
  if (typeof f.format !== "string" || !f.format.startsWith("timetable-app/")) {
    return { ok: false, reason: "時間割ファイルの形式ではありません" };
  }
  if (!f.meta || typeof f.meta !== "object") return { ok: false, reason: "meta がありません" };
  const hasSemesters = Array.isArray(f.semesters) && f.semesters.length > 0;
  const hasLegacy = Array.isArray(f.base);
  if (!hasSemesters && !hasLegacy) {
    return { ok: false, reason: "時間割の中身（base / semesters）がありません" };
  }
  return { ok: true };
}

/** 2つの updatedAt を比較。a が新しければ正。 */
export function isNewer(a?: string, b?: string): boolean {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}
