// Google Drive「サーバー経由ログイン」のクライアント側。
// 従来の GIS ポップアップ再ログインを、可能な場合は使わずに済ませる。
//
// サーバー(server/driveAuth.ts)が GOOGLE_CLIENT_SECRET を持ち、リフレッシュトークンを
// 保持している場合のみ機能する。未設定の環境（Vercel等）では常に「使えない」を返し、
// 既存の googleDrive.ts のGISフローがそのままフォールバックとして動く。

const K_LINKED = "drive.server.linked"; // 直近の /status で linked=true だったか（軽いキャッシュ）

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("sync.token") || "";
  return token ? { "x-sync-token": token } : {};
}

export interface DriveServerStatus {
  configured: boolean;
  linked: boolean;
}

/** サーバーがOAuth連携済みかを確認する。到達できなければ configured:false 相当を返す。 */
export async function fetchDriveServerStatus(): Promise<DriveServerStatus> {
  try {
    const res = await fetch("/api/drive/status", { cache: "no-store" });
    if (!res.ok) return { configured: false, linked: false };
    const s = (await res.json()) as DriveServerStatus;
    localStorage.setItem(K_LINKED, s.linked ? "1" : "0");
    return s;
  } catch {
    return { configured: false, linked: false };
  }
}

/**
 * 連携用の同意画面URLを取得し、既に開いてあるタブへ遷移させる。
 *
 * ★重要: window.open は「ユーザー操作のクリックハンドラ内で同期的に」呼ぶ必要があり、
 * かつ noopener を付けると返り値の Window が操作不能（null 相当）になることがある
 * （tab.location への書き込みが効かず、空タブのまま残る不具合の原因だった）。
 * そのため window.open はこの関数の外＝onClick の最上位で同期的に呼び、
 * ここでは既に開いた Window への書き込みだけを行う。
 */
export async function startDriveServerLink(
  tab: Window | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/drive/auth-url", { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      tab?.close();
      return { ok: false, error: `auth-url取得に失敗 (HTTP ${res.status})` };
    }
    const { url } = (await res.json()) as { url: string };
    if (tab && !tab.closed) {
      tab.location.href = url;
    } else {
      // ポップアップブロックでタブが取れなかった場合は同一タブで遷移する
      window.location.href = url;
    }
    return { ok: true };
  } catch (e) {
    tab?.close();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * サーバー保持のリフレッシュトークンから、有効な access_token を取得する。
 * 使えない場合（未連携・未設定・サーバー到達不可）は null を返し、
 * 呼び出し側は従来のGISポップアップにフォールバックする。
 */
export async function getServerManagedToken(): Promise<{ token: string; expiresAt: number } | null> {
  // 一度も連携していないことが分かっている場合はネットワークを叩かない
  if (localStorage.getItem(K_LINKED) === "0") return null;
  try {
    const res = await fetch("/api/drive/token", { headers: authHeaders(), cache: "no-store" });
    if (res.status === 404) {
      localStorage.setItem(K_LINKED, "0");
      return null;
    }
    if (!res.ok) return null;
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    localStorage.setItem(K_LINKED, "1");
    return { token: access_token, expiresAt: Date.now() + Math.max(expires_in - 300, 60) * 1000 };
  } catch {
    return null; // サーバー未起動・オフライン等。GISへフォールバック
  }
}

export async function unlinkDriveServer(): Promise<void> {
  try {
    await fetch("/api/drive/unlink", { method: "POST", headers: authHeaders() });
  } catch {
    /* ignore */
  }
  localStorage.setItem(K_LINKED, "0");
}
