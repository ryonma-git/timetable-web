// 時間割スナップショットの同期ストア（ホスト非依存）。
//
// 契約(SyncStore)は自宅サーバ(ファイルシステム)でもVercel(KV/Blob)でも同じ。
// まずは FileSyncStore を使う。Vercel化する時は KvSyncStore 等を足して
// createSyncStore() の分岐を1行変えるだけにする（アプリ側/APIは無変更）。
//
// 版管理: put ごとに version を単調増加。直近 KEEP 版を versions/ に残し、
// 誤上書きから戻せるようにする（設計 N5「取り返しのつく設計」）。
// E2E は今回は入れない（payload は平文JSON）。将来 payload を ciphertext に
// 差し替えても本ストアは無改修（中身を解釈しないため）。

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export interface Snapshot {
  version: number;
  updatedAt: string; // TimetableFile.meta.updatedAt（クライアント時刻）
  savedAt: string; // サーバ受領時刻
  device?: string; // 送信端末の識別（任意・表示用）
  payload: unknown; // TimetableFile（将来は暗号文でも可）
}

export type PutResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; serverVersion: number; updatedAt: string };

export interface SyncStore {
  kind: string;
  get(): Promise<Snapshot | null>;
  put(input: {
    payload: unknown;
    updatedAt: string;
    baseVersion?: number | null;
    device?: string;
  }): Promise<PutResult>;
  listVersions(limit?: number): Promise<Array<Pick<Snapshot, "version" | "updatedAt" | "savedAt" | "device">>>;
  getVersion(version: number): Promise<Snapshot | null>;
}

const KEEP_VERSIONS = 30;

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

export class FileSyncStore implements SyncStore {
  kind = "file";
  private dir: string;
  private curFile: string;
  private verDir: string;

  constructor(dataDir?: string) {
    this.dir = dataDir || process.env.SYNC_DATA_DIR || path.join(repoRoot(), ".sync-data");
    this.curFile = path.join(this.dir, "snapshot.json");
    this.verDir = path.join(this.dir, "versions");
    fs.mkdirSync(this.verDir, { recursive: true });
  }

  async get(): Promise<Snapshot | null> {
    try {
      const raw = await fsp.readFile(this.curFile, "utf-8");
      return JSON.parse(raw) as Snapshot;
    } catch {
      return null;
    }
  }

  async put(input: {
    payload: unknown;
    updatedAt: string;
    baseVersion?: number | null;
    device?: string;
  }): Promise<PutResult> {
    const cur = await this.get();
    const curVersion = cur?.version ?? 0;

    // 競合検知: baseVersion を明示してきた場合、サーバ現版と食い違えば 409。
    if (
      input.baseVersion !== undefined &&
      input.baseVersion !== null &&
      input.baseVersion !== curVersion
    ) {
      return {
        ok: false,
        conflict: true,
        serverVersion: curVersion,
        updatedAt: cur?.updatedAt ?? "",
      };
    }

    const snap: Snapshot = {
      version: curVersion + 1,
      updatedAt: input.updatedAt,
      savedAt: new Date().toISOString(),
      device: input.device,
      payload: input.payload,
    };
    // 版を残してから現行を差し替え（原子性重視: tmp→rename）
    await this.writeAtomic(path.join(this.verDir, `v${snap.version}.json`), snap);
    await this.writeAtomic(this.curFile, snap);
    await this.pruneVersions();
    return { ok: true, version: snap.version };
  }

  async listVersions(limit = KEEP_VERSIONS) {
    const files = await this.versionFiles();
    const out: Array<Pick<Snapshot, "version" | "updatedAt" | "savedAt" | "device">> = [];
    for (const f of files.slice(0, limit)) {
      try {
        const s = JSON.parse(await fsp.readFile(path.join(this.verDir, f), "utf-8")) as Snapshot;
        out.push({ version: s.version, updatedAt: s.updatedAt, savedAt: s.savedAt, device: s.device });
      } catch {
        /* skip */
      }
    }
    return out;
  }

  async getVersion(version: number): Promise<Snapshot | null> {
    try {
      return JSON.parse(
        await fsp.readFile(path.join(this.verDir, `v${version}.json`), "utf-8")
      ) as Snapshot;
    } catch {
      return null;
    }
  }

  private async writeAtomic(file: string, obj: unknown) {
    // 実行中にディレクトリが消えても復旧できるよう毎回保証（冪等・安価）。
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(obj), "utf-8");
    await fsp.rename(tmp, file);
  }

  private async versionFiles(): Promise<string[]> {
    const all = await fsp.readdir(this.verDir).catch(() => [] as string[]);
    return all
      .filter((f) => /^v\d+\.json$/.test(f))
      .sort((a, b) => Number(b.slice(1, -5)) - Number(a.slice(1, -5))); // 新しい順
  }

  private async pruneVersions() {
    const files = await this.versionFiles();
    for (const f of files.slice(KEEP_VERSIONS)) {
      await fsp.unlink(path.join(this.verDir, f)).catch(() => {});
    }
  }
}

/**
 * Vercel KV / Upstash Redis 実装（REST API・SDK不要）。
 * 環境変数 KV_REST_API_URL / KV_REST_API_TOKEN（Vercel KV連携が自動注入）で動く。
 * キー: tt:snapshot(現行) / tt:v{n}(各版) / tt:index(版メタのJSON配列, cap KEEP)。
 */
export class KvSyncStore implements SyncStore {
  kind = "kv";
  constructor(
    private url: string,
    private token: string
  ) {}

  private async cmd(...args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`KV error ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { result?: unknown };
    return j.result;
  }
  private async getJson<T>(key: string): Promise<T | null> {
    const v = (await this.cmd("GET", key)) as string | null;
    return v ? (JSON.parse(v) as T) : null;
  }

  async get(): Promise<Snapshot | null> {
    return this.getJson<Snapshot>("tt:snapshot");
  }

  async put(input: {
    payload: unknown;
    updatedAt: string;
    baseVersion?: number | null;
    device?: string;
  }): Promise<PutResult> {
    const cur = await this.get();
    const curVersion = cur?.version ?? 0;
    if (
      input.baseVersion !== undefined &&
      input.baseVersion !== null &&
      input.baseVersion !== curVersion
    ) {
      return { ok: false, conflict: true, serverVersion: curVersion, updatedAt: cur?.updatedAt ?? "" };
    }
    const snap: Snapshot = {
      version: curVersion + 1,
      updatedAt: input.updatedAt,
      savedAt: new Date().toISOString(),
      device: input.device,
      payload: input.payload,
    };
    await this.cmd("SET", `tt:v${snap.version}`, JSON.stringify(snap));
    await this.cmd("SET", "tt:snapshot", JSON.stringify(snap));
    // 版インデックス更新（cap KEEP、古い版キーは掃除）
    const idx = (await this.getJson<number[]>("tt:index")) ?? [];
    idx.push(snap.version);
    const prune = idx.slice(0, Math.max(0, idx.length - KEEP_VERSIONS));
    const kept = idx.slice(-KEEP_VERSIONS);
    await this.cmd("SET", "tt:index", JSON.stringify(kept));
    for (const v of prune) await this.cmd("DEL", `tt:v${v}`).catch(() => undefined);
    return { ok: true, version: snap.version };
  }

  async listVersions(limit = KEEP_VERSIONS) {
    const idx = ((await this.getJson<number[]>("tt:index")) ?? []).slice(-limit).reverse();
    const out: Array<Pick<Snapshot, "version" | "updatedAt" | "savedAt" | "device">> = [];
    for (const v of idx) {
      const s = await this.getJson<Snapshot>(`tt:v${v}`);
      if (s) out.push({ version: s.version, updatedAt: s.updatedAt, savedAt: s.savedAt, device: s.device });
    }
    return out;
  }

  async getVersion(version: number): Promise<Snapshot | null> {
    return this.getJson<Snapshot>(`tt:v${version}`);
  }
}

let _store: SyncStore | null = null;
export function getSyncStore(): SyncStore {
  if (!_store) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    // Vercel KV/Upstash が設定されていればそれを、無ければローカルFS（自宅サーバ/dev）。
    _store = url && token ? new KvSyncStore(url, token) : new FileSyncStore();
  }
  return _store;
}
