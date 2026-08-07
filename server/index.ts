import express from "express";
import { createServer } from "http";
import path from "path";
import fsp from "node:fs/promises";
import zlib from "node:zlib";
import { fileURLToPath } from "url";
import { handleRefresh, actionFromPath } from "./refreshEngine";
import { handleSync } from "./syncApi";
import { handleDriveApi, normalizeDrivePath } from "./driveApi";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};
function contentTypeFor(p: string): string {
  const ext = p.slice(p.lastIndexOf("."));
  return MIME[ext] ?? "application/octet-stream";
}

function isLoopback(ip?: string): boolean {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // 年間指導計画「取得ブラウザ」API（本番）。scripts/ が同梱されている場合に動作。
  app.get("/api/refresh/:action", async (req, res) => {
    const action = actionFromPath(`/${req.params.action}`);
    if (!action) {
      res.status(404).json({ ok: false, error: "unknown_action" });
      return;
    }
    const { status, json } = await handleRefresh(action);
    res.status(status).json(json);
  });

  // 時間割スナップショット同期API（自宅サーバ本番）。
  app.use("/api/sync", express.json({ limit: "8mb" }), async (req, res) => {
    // どの端末がいつ何を叩いたかを残す（「iPhoneから届いていない」等の切り分け用）
    const ua = req.header("user-agent") || "";
    const kind = /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Macintosh/i.test(ua) ? "Mac" : "その他";
    console.log(
      `[sync] ${new Date().toISOString()} ${req.method} ${req.path} from=${kind} ip=${req.socket.remoteAddress} ua=${ua.slice(0, 80)}`
    );
    const { status, json } = await handleSync({
      method: req.method,
      pathname: req.path || "/",
      token: (req.header("x-sync-token") as string) || null,
      isLocal: isLoopback(req.socket.remoteAddress || undefined),
      body: async () => req.body ?? null,
    });
    if (status === 204) {
      res.status(204).end();
      return;
    }
    res.status(status).json(json);
  });

  // Google Drive サーバー経由ログイン（都度ログイン解消。任意・GOOGLE_CLIENT_SECRET未設定なら404扱い）
  app.get("/api/drive/*", async (req, res) => {
    const r = await handleDriveApi({
      method: req.method,
      pathname: normalizeDrivePath(req.originalUrl),
      token: (req.header("x-sync-token") as string) || null,
      query: new URLSearchParams(req.query as Record<string, string>),
      origin: `${req.protocol}://${req.get("host")}`,
    });
    if (r.html) {
      res.status(r.status).type("html").send(r.html);
      return;
    }
    res.status(r.status).json(r.json);
  });
  app.post("/api/drive/*", async (req, res) => {
    const r = await handleDriveApi({
      method: req.method,
      pathname: normalizeDrivePath(req.originalUrl),
      token: (req.header("x-sync-token") as string) || null,
      query: new URLSearchParams(),
      origin: `${req.protocol}://${req.get("host")}`,
    });
    res.status(r.status).json(r.json);
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  // gzip 圧縮（依存を増やさず Node 標準の zlib で実装）。
  // メインJSが約3MBあり、無圧縮だとスマホでの初回読み込みが実用に耐えないため。
  // 圧縮済みを .gz としてディスクにキャッシュし、2回目以降は即返す。
  const GZIP_TARGET = /\.(js|css|html|json|svg|map)$/i;
  app.use(async (req, res, next) => {
    if (req.method !== "GET" || !GZIP_TARGET.test(req.path)) return next();
    if (!/\bgzip\b/.test(req.headers["accept-encoding"] || "")) return next();
    const filePath = path.join(staticPath, req.path);
    try {
      const st = await fsp.stat(filePath);
      if (!st.isFile()) return next();
      const gzPath = `${filePath}.gz`;
      let gzStat = await fsp.stat(gzPath).catch(() => null);
      if (!gzStat || gzStat.mtimeMs < st.mtimeMs) {
        const raw = await fsp.readFile(filePath);
        await fsp.writeFile(gzPath, zlib.gzipSync(raw, { level: 6 }));
        gzStat = await fsp.stat(gzPath);
      }
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("Content-Type", contentTypeFor(req.path));
      // 内容ハッシュ付きのビルド成果物は不変なので長期キャッシュ
      if (/\/assets\//.test(req.path)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      res.sendFile(gzPath);
      return;
    } catch {
      return next();
    }
  });

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
