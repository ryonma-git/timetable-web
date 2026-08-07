import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

// 年間指導計画「取得ブラウザ」API（dev）。アプリからCLIなしで改訂チェックを起動する。
function refreshApiPlugin(): Plugin {
  return {
    name: "teaching-plan-refresh-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/refresh", async (req, res) => {
        try {
          const { handleRefresh, actionFromPath } = await import("./server/refreshEngine");
          const action = actionFromPath((req.url || "").split("?")[0]);
          if (!action) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "unknown_action" }));
            return;
          }
          const { status, json } = await handleRefresh(action);
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(json));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: String((e as Error).message || e) }));
        }
      });
    },
  };
}

// 時間割スナップショット同期API（dev）。自宅サーバ相当をローカルでも動かす。
function syncApiPlugin(): Plugin {
  return {
    name: "timetable-sync-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/sync", async (req, res) => {
        try {
          const { handleSync, normalizeSyncPath } = await import("./server/syncApi");
          const remote = req.socket.remoteAddress || "";
          const isLocal =
            remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
          const { status, json } = await handleSync({
            method: req.method || "GET",
            pathname: normalizeSyncPath(req.originalUrl || req.url || ""),
            token: (req.headers["x-sync-token"] as string) || null,
            isLocal,
            body: () =>
              new Promise((resolve) => {
                let b = "";
                req.on("data", (c) => (b += c));
                req.on("end", () => {
                  try {
                    resolve(b ? JSON.parse(b) : null);
                  } catch {
                    resolve(null);
                  }
                });
              }),
          });
          if (status === 204) {
            res.statusCode = 204;
            res.end();
            return;
          }
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(json));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String((e as Error).message || e) }));
        }
      });
    },
  };
}

// Google Drive サーバー経由ログイン（dev）。
function driveApiPlugin(): Plugin {
  return {
    name: "timetable-drive-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/drive", async (req, res) => {
        try {
          const { handleDriveApi, normalizeDrivePath } = await import("./server/driveApi");
          const url = new URL(req.originalUrl || req.url || "", "http://localhost");
          const r = await handleDriveApi({
            method: req.method || "GET",
            pathname: normalizeDrivePath(req.originalUrl || req.url || ""),
            token: (req.headers["x-sync-token"] as string) || null,
            query: url.searchParams,
            origin: `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`,
          });
          if (r.html) {
            res.statusCode = r.status;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(r.html);
            return;
          }
          res.statusCode = r.status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(r.json));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String((e as Error).message || e) }));
        }
      });
    },
  };
}

const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector(), refreshApiPlugin(), syncApiPlugin(), driveApiPlugin()];

export default defineConfig({
  plugins,
  // GitHub Pagesデプロイ時は VITE_BASE_URL=/timetable-web/ を設定する
  base: process.env.VITE_BASE_URL ?? '/',
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // ファイル内容に基づくハッシュでキャッシュバスターを防ぐ
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  server: {
    port: 3000,
    strictPort: false, // Will find next available port if 3000 is busy
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
