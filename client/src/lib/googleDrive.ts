// Google Drive API utility for timetable file sync
// Uses Google Identity Services (GIS) token client (implicit flow)
//
// 設計方針（フールプルーフ2段階）:
//   【自動同期】 appDataFolder スコープ → 隠しフォルダに自動保存（ユーザーが誤って削除しにくい）
//   【手動バックアップ】 drive.file スコープ → マイドライブ/時間割管理/ に日付付きファイルを保存
//   【カレンダー出力】 calendar.events スコープ → Googleカレンダーにイベントを追加
//
// スコープは全て同時にリクエストし、1回のログインで全機能が使える。

export const GOOGLE_CLIENT_ID =
  "693809505459-k6n5u58rkccfelk5vi8nl0ee1k34435c.apps.googleusercontent.com";

// All scopes requested at once (one login covers all features)
const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",   // 自動同期（隠しフォルダ）
  "https://www.googleapis.com/auth/drive.file",       // 手動バックアップ（マイドライブ）
  "https://www.googleapis.com/auth/calendar.events",  // Googleカレンダー出力
].join(" ");

// Auto-sync: hidden appDataFolder
const DRIVE_FILENAME = "timetable_data.timetable";

// Backup: visible folder in My Drive
const BACKUP_FOLDER_NAME = "時間割管理";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GoogleUser {
  name: string;
  email: string;
  picture: string;
}

// GIS token client type (minimal)
interface TokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

// GIS global type (avoid conflict with TypeScript's built-in google namespace)
interface GISAccounts {
  oauth2: {
    initTokenClient: (config: {
      client_id: string;
      scope: string;
      callback: (response: { access_token?: string; error?: string }) => void;
    }) => TokenClient;
  };
  id: {
    initialize: (config: {
      client_id: string;
      callback: (response: { credential: string }) => void;
    }) => void;
    renderButton: (element: HTMLElement, config: object) => void;
    prompt: () => void;
  };
}

declare global {
  interface Window {
    googleGIS?: { accounts: GISAccounts };
  }
}

// Helper to access GIS safely (window.google conflicts with TS built-in)
function getGIS(): { accounts: GISAccounts } | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).google as { accounts: GISAccounts } | undefined;
}

// ─── Token management ────────────────────────────────────────────────────────

let accessToken: string | null = null;
let tokenClient: TokenClient | null = null;
let tokenExpiresAt = 0;

export function getAccessToken(): string | null {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  return null;
}

export function isTokenValid(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

// ─── Initialize GIS token client ─────────────────────────────────────────────

export function initGoogleAuth(
  onTokenReceived: (token: string) => void,
  onError: (error: string) => void
): void {
  const gis = getGIS();
  if (!gis?.accounts?.oauth2) {
    onError("Google Identity Services が読み込まれていません");
    return;
  }
  tokenClient = gis.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: (response: { access_token?: string; error?: string }) => {
      if (response.error) {
        onError(response.error);
        return;
      }
      if (response.access_token) {
        accessToken = response.access_token;
        // GIS tokens expire in 3600s; set expiry 5 min early for safety
        tokenExpiresAt = Date.now() + 55 * 60 * 1000;
        onTokenReceived(response.access_token);
      }
    },
  });
}

export function requestAccessToken(prompt = ""): void {
  if (!tokenClient) throw new Error("Token client not initialized");
  tokenClient.requestAccessToken({ prompt });
}

export function revokeToken(): void {
  accessToken = null;
  tokenExpiresAt = 0;
}

// ─── Drive API helpers ───────────────────────────────────────────────────────

async function driveRequest(
  path: string,
  method: string,
  params?: Record<string, string>,
  body?: string,
  contentType?: string
): Promise<Response> {
  const token = getAccessToken();
  if (!token) throw new Error("アクセストークンがありません。再ログインしてください。");

  const url = new URL(`https://www.googleapis.com${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (contentType) headers["Content-Type"] = contentType;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API エラー (${res.status}): ${text}`);
  }
  return res;
}

// ─── 【自動同期】 appDataFolder ──────────────────────────────────────────────
// 隠しフォルダへの保存。ユーザーが誤って削除しにくく、常に最新状態を保つ。

export async function findDriveFile(): Promise<string | null> {
  const res = await driveRequest("/drive/v3/files", "GET", {
    spaces: "appDataFolder",
    fields: "files(id,name,modifiedTime)",
    q: `name = '${DRIVE_FILENAME}'`,
  });
  const data = (await res.json()) as { files: { id: string; name: string }[] };
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

export async function uploadToDrive(content: string): Promise<string> {
  const token = getAccessToken();
  if (!token) throw new Error("アクセストークンがありません");

  const existingId = await findDriveFile();
  const metadata = {
    name: DRIVE_FILENAME,
    parents: existingId ? undefined : ["appDataFolder"],
  };

  const boundary = "timetable_boundary_" + Date.now();
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const path = existingId
    ? `/upload/drive/v3/files/${existingId}`
    : "/upload/drive/v3/files";
  const method = existingId ? "PATCH" : "POST";

  const url = new URL(`https://www.googleapis.com${path}`);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,modifiedTime");

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive アップロードエラー (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function downloadFromDrive(fileId: string): Promise<string> {
  const res = await driveRequest(`/drive/v3/files/${fileId}`, "GET", {
    alt: "media",
  });
  return await res.text();
}

export async function getDriveFileMetadata(
  fileId: string
): Promise<{ modifiedTime: string } | null> {
  try {
    const res = await driveRequest(`/drive/v3/files/${fileId}`, "GET", {
      fields: "id,name,modifiedTime",
    });
    return (await res.json()) as { modifiedTime: string };
  } catch {
    return null;
  }
}

// ─── 【手動バックアップ】 マイドライブ/時間割管理/ ────────────────────────────
// drive.file スコープ。日付付きファイル名でマイドライブに保存。
// Finder（Mac）やDriveウェブUIから確認・ダウンロード可能。

let cachedBackupFolderId: string | null = null;

async function getOrCreateBackupFolder(): Promise<string> {
  if (cachedBackupFolderId) return cachedBackupFolderId;

  const token = getAccessToken();
  if (!token) throw new Error("アクセストークンがありません");

  // Search for existing folder
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name = '${BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    )}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!searchRes.ok) throw new Error(`フォルダ検索エラー (${searchRes.status})`);
  const searchData = (await searchRes.json()) as { files: { id: string }[] };

  if (searchData.files && searchData.files.length > 0) {
    cachedBackupFolderId = searchData.files[0].id;
    return cachedBackupFolderId;
  }

  // Create folder
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: BACKUP_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`フォルダ作成エラー (${createRes.status}): ${text}`);
  }

  const folder = (await createRes.json()) as { id: string };
  cachedBackupFolderId = folder.id;
  return cachedBackupFolderId;
}

/**
 * マイドライブ/時間割管理/ に日付付きバックアップファイルを作成する。
 * 上書きせず毎回新規作成（世代管理）。
 * @returns 作成されたファイルのID
 */
export async function backupToDrive(
  content: string,
  titleHint = "時間割"
): Promise<{ fileId: string; fileName: string; folderName: string }> {
  const token = getAccessToken();
  if (!token) throw new Error("アクセストークンがありません");

  const folderId = await getOrCreateBackupFolder();

  // 日付付きファイル名: 時間割_2026-05-09_1430.timetable
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const safeName = titleHint.replace(/[/\\:*?"<>|]/g, "_");
  const fileName = `${safeName}_${datePart}_${timePart}.timetable`;

  const boundary = "timetable_backup_" + Date.now();
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name: fileName, parents: [folderId] }),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`バックアップエラー (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string; name: string };
  return { fileId: data.id, fileName: data.name, folderName: BACKUP_FOLDER_NAME };
}

/**
 * マイドライブ/時間割管理/ 内のバックアップファイル一覧を取得する（新しい順）
 */
export async function listBackupFiles(): Promise<
  { id: string; name: string; modifiedTime: string }[]
> {
  const token = getAccessToken();
  if (!token) return [];

  try {
    const folderId = await getOrCreateBackupFolder();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `'${folderId}' in parents and trashed = false`
      )}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&spaces=drive`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      files: { id: string; name: string; modifiedTime: string }[];
    };
    return data.files ?? [];
  } catch {
    return [];
  }
}

// ─── 【Googleカレンダー出力】 ────────────────────────────────────────────────

export interface CalendarEvent {
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  colorId?: string;
}

export interface CalendarInsertResult {
  inserted: number;
  errors: number;
  calendarId: string;
}

/**
 * Googleカレンダーに複数イベントを追加する。
 * 進捗コールバック付き。
 */
export async function insertCalendarEvents(
  events: CalendarEvent[],
  calendarId = "primary",
  onProgress?: (done: number, total: number) => void
): Promise<CalendarInsertResult> {
  const token = getAccessToken();
  if (!token) throw new Error("アクセストークンがありません。再ログインしてください。");

  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }
      );
      if (res.ok) {
        inserted++;
      } else {
        errors++;
      }
    } catch {
      errors++;
    }
    onProgress?.(i + 1, events.length);
    // Rate limiting: small delay between requests
    if (i < events.length - 1) {
      await new Promise(r => setTimeout(r, 60));
    }
  }

  return { inserted, errors, calendarId };
}

/**
 * ユーザーが書き込み可能なカレンダー一覧を取得する（カレンダー選択ダイアログ用）
 */
export async function listCalendars(): Promise<
  { id: string; summary: string; primary?: boolean; backgroundColor?: string }[]
> {
  const token = getAccessToken();
  if (!token) throw new Error("アクセストークンがありません");

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`カレンダー一覧取得エラー (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    items: { id: string; summary: string; primary?: boolean; backgroundColor?: string }[];
  };
  return data.items ?? [];
}
