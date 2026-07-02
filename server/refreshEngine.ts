// 年間指導計画「取得ブラウザ」のバックエンド・ブリッジ。
// アプリ(ブラウザSPA)から CLI を使わずに改訂チェックを走らせるため、
// Node 側で scripts/refresh_teaching_plans.py を子プロセス起動し JSON を返す。
//
// 同じハンドラを Vite dev サーバ(middleware)と本番 express の双方で使う。
// 将来 Mac/iOS ラッパーからも同じ HTTP API を叩けばよい。

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// リポジトリのルート（scripts/ と client/ がある場所）を探す。
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "scripts", "refresh_teaching_plans.py"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

const REPO_ROOT = findRepoRoot();
const SCRIPT = path.join(REPO_ROOT, "scripts", "refresh_teaching_plans.py");
const PYTHON = process.env.PYTHON_BIN || "python3";

export function engineAvailable(): boolean {
  return fs.existsSync(SCRIPT);
}

function runPy(args: string[], timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT, ...args], { cwd: REPO_ROOT });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("refresh engine timed out"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`refresh engine exited ${code}: ${err.slice(0, 500)}`));
    });
  });
}

/** 現在の状態（直近の check 結果ベース）を取得。ネットには出ない。 */
export async function getUiState(): Promise<unknown> {
  const out = await runPy(["ui"]);
  return JSON.parse(out);
}

// run は同時実行させない（連打で複数の python が state/report を書き競合するのを防ぐ）。
// 実行中に再度呼ばれたら同じ実行結果を共有して返す。
let inflightRun: Promise<unknown> | null = null;

/** 本年度取得＝配布元を再取得して改訂検知し、最新状態を返す（ネットに出る）。 */
export function runCheck(): Promise<unknown> {
  if (!inflightRun) {
    inflightRun = (async () => {
      try {
        // URL登録が増えるほど時間がかかるため長め（curl 30s × 直列）
        await runPy(["check"], 300_000);
        return await getUiState();
      } finally {
        inflightRun = null;
      }
    })();
  }
  return inflightRun;
}

export type RefreshAction = "sources" | "run" | "health";

/** フレームワーク非依存のコアハンドラ。{status, json} を返す。 */
export async function handleRefresh(action: RefreshAction): Promise<{ status: number; json: unknown }> {
  if (!engineAvailable()) {
    return { status: 503, json: { ok: false, error: "engine_unavailable", scriptExpected: SCRIPT } };
  }
  try {
    if (action === "health") return { status: 200, json: { ok: true, root: REPO_ROOT } };
    if (action === "sources") return { status: 200, json: await getUiState() };
    if (action === "run") return { status: 200, json: await runCheck() };
    return { status: 404, json: { ok: false, error: "unknown_action" } };
  } catch (e) {
    return { status: 500, json: { ok: false, error: String((e as Error).message || e) } };
  }
}

export function actionFromPath(urlPath: string): RefreshAction | null {
  if (urlPath.endsWith("/health")) return "health";
  if (urlPath.endsWith("/sources")) return "sources";
  if (urlPath.endsWith("/run")) return "run";
  return null;
}
