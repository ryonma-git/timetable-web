// Vercel サーバレス関数: /api/sync/* を処理する catch-all。
// 自宅サーバ(express)と同じ handleSync を再利用する（ロジック単一）。
// ストレージは server/syncStore.ts が環境変数(KV_REST_API_URL)を見て
// Vercel KV(Upstash) を自動選択する。
//
// 注: @vercel/node に依存しないよう req/res は構造的型で受ける。

import { handleSync, normalizeSyncPath } from "../../server/syncApi";

interface VReq {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface VRes {
  status: (code: number) => VRes;
  json: (body: unknown) => void;
  end: (body?: unknown) => void;
}

export default async function handler(req: VReq, res: VRes): Promise<void> {
  const raw = req.headers["x-sync-token"];
  const token = (Array.isArray(raw) ? raw[0] : raw) || null;
  const { status, json } = await handleSync({
    method: req.method || "GET",
    pathname: normalizeSyncPath(req.url || ""),
    token,
    isLocal: false, // Vercel はクライアントに対してローカルではない（bootstrap-tokenは無効）
    body: async () => req.body ?? null,
  });
  if (status === 204) {
    res.status(204).end();
    return;
  }
  res.status(status).json(json);
}
