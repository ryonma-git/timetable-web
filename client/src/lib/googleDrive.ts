// Google Drive API utility for timetable file sync
// Uses Google Identity Services (GIS) token client (implicit flow)
// Only accesses appDataFolder — no access to user's regular Drive files

export const GOOGLE_CLIENT_ID =
  "693809505459-k6n5u58rkccfelk5vi8nl0ee1k34435c.apps.googleusercontent.com";

// Scopes: appdata only (hidden folder, no access to user files)
const SCOPES = "https://www.googleapis.com/auth/drive.appdata";

// File name stored in appDataFolder
const DRIVE_FILENAME = "timetable_data.timetable";

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

// ─── Find existing file in appDataFolder ─────────────────────────────────────

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

// ─── Upload (create or update) ───────────────────────────────────────────────

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

// ─── Download ────────────────────────────────────────────────────────────────

export async function downloadFromDrive(fileId: string): Promise<string> {
  const res = await driveRequest(`/drive/v3/files/${fileId}`, "GET", {
    alt: "media",
  });
  return await res.text();
}

// ─── Get file metadata (modifiedTime) ────────────────────────────────────────

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
