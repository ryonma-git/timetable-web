// GoogleDriveContext: manages Google Drive login state, auto-sync, and backup
// Uses GIS implicit token flow (client_id only, no client_secret in frontend)
//
// 設計:
//   syncToDrive      → appDataFolder（隠しフォルダ）への自動同期
//   backupToMyDrive  → マイドライブ/時間割管理/ への手動バックアップ（日付付きファイル名）
//   loadFromDrive    → appDataFolder から復元

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import {
  GOOGLE_CLIENT_ID,
  initGoogleAuth,
  requestAccessToken,
  revokeToken,
  isTokenValid,
  findDriveFile,
  uploadToDrive,
  downloadFromDrive,
  backupToDrive,
  listBackupFiles,
} from "@/lib/googleDrive";
import { serializeTimetableFile, deserializeTimetableFile } from "@/lib/timetableFile";
import { toast } from "sonner";
import type { TimetableFile } from "@/lib/timetableFile";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SyncStatus =
  | "idle"
  | "syncing"
  | "synced"
  | "error"
  | "conflict";

export type BackupStatus = "idle" | "backing_up" | "done" | "error";

export interface BackupFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export interface GoogleDriveContextValue {
  isLoggedIn: boolean;
  /** ページリロード後のサイレントログイン復元中フラグ */
  isRestoringLogin: boolean;
  /** サイレントログイン復元が失敗したフラグ（手動再ログインが必要） */
  silentRestoreFailed: boolean;
  /** 自動同期ステータス（appDataFolder） */
  syncStatus: SyncStatus;
  lastSyncedAt: Date | null;
  syncError: string | null;
  /** 手動バックアップステータス（マイドライブ） */
  backupStatus: BackupStatus;
  lastBackupAt: Date | null;
  backupError: string | null;
  login: () => void;
  /** アカウント再同意（再認証）— 既ログイン時でも consent 画面を再表示 */
  relogin: () => void;
  /** サードパーティCookieの許可をブラウザに要求（Storage Access API） */
  requestCookieAccess: () => Promise<boolean>;
  logout: () => void;
  /** 【自動同期】appDataFolderへアップロード */
  syncToDrive: (file: TimetableFile, allOps: unknown[]) => Promise<void>;
  /** 【手動バックアップ】マイドライブ/時間割管理/に日付付きファイルを作成 */
  backupToMyDrive: (file: TimetableFile, allOps: unknown[]) => Promise<{ fileName: string; folderName: string } | null>;
  /** appDataFolderからダウンロードして復元 */
  loadFromDrive: () => Promise<{ file: TimetableFile; warnings: string[] } | null>;
  /** バックアップファイル一覧を取得 */
  getBackupFiles: () => Promise<BackupFile[]>;
  /** appDataFolderにファイルがあるか確認 */
  hasDriveFile: () => Promise<boolean>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const GoogleDriveContext = createContext<GoogleDriveContextValue | null>(null);

export function useGoogleDrive(): GoogleDriveContextValue {
  const ctx = useContext(GoogleDriveContext);
  if (!ctx) throw new Error("useGoogleDrive must be used within GoogleDriveProvider");
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

const LOGGED_IN_KEY = "gdrive_logged_in";

export function GoogleDriveProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRestoringLogin, setIsRestoringLogin] = useState(() => localStorage.getItem("gdrive_logged_in") === "1");
  const [silentRestoreFailed, setSilentRestoreFailed] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>("idle");
  const [lastBackupAt, setLastBackupAt] = useState<Date | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const gisReadyRef = useRef(false);
  const [gisReady, setGisReady] = useState(false);
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize GIS when the script is loaded
  useEffect(() => {
    const tryInit = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gis = (window as any).google as { accounts?: { oauth2?: unknown; id?: unknown } } | undefined;
      if (!gis?.accounts) return false;

      initGoogleAuth(
        (token) => {
          if (token) {
            // Clear previous auto-refresh timer and set a new one for 55 min
            if (tokenRefreshTimerRef.current) {
              clearTimeout(tokenRefreshTimerRef.current);
            }
            tokenRefreshTimerRef.current = setTimeout(() => {
              requestAccessToken("");
            }, 55 * 60 * 1000);

            setIsLoggedIn(true);
            setIsRestoringLogin(false);
            setSilentRestoreFailed(false);
            localStorage.setItem(LOGGED_IN_KEY, "1");
          }
        },
        (err) => {
          console.error("GIS auth error:", err);
          setSyncError(err);
        }
      );

      // Google One Tap は無効化中（Googleのポップアップサービス、不要なため）
      // 再有効化する場合はこのブロックを復元すること

      gisReadyRef.current = true;
      setGisReady(true);
      return true;
    };

    // Try immediately (script may already be loaded)
    if (tryInit()) return;

    // Poll until GIS script is ready
    const interval = setInterval(() => {
      if (tryInit()) clearInterval(interval);
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // Auto-restore login state: if user was logged in before, silently request token
  useEffect(() => {
    if (!gisReady) return;
    const wasLoggedIn = localStorage.getItem(LOGGED_IN_KEY) === "1";
    if (wasLoggedIn && !isTokenValid()) {
      // Silent token refresh (no popup — GIS will reuse existing consent)
      setIsRestoringLogin(true);
      try {
        requestAccessToken("");
        // isRestoringLogin will be cleared when token callback fires (setIsLoggedIn(true))
        // or after a timeout fallback
        setTimeout(() => {
          if (!isTokenValid()) {
            setIsRestoringLogin(false);
            setSilentRestoreFailed(true);
            toast.warning(
              "Googleログインが切れました。再ログインが必要です。",
              {
                duration: 8000,
                action: {
                  label: "再ログイン",
                  onClick: () => requestAccessToken("consent"),
                },
              }
            );
          } else {
            setIsRestoringLogin(false);
          }
        }, 5000);
      } catch {
        setIsRestoringLogin(false);
        // Ignore — user will need to log in manually
      }
    } else {
      setIsRestoringLogin(false);
    }
  }, [gisReady]); // runs once when GIS is ready

  const login = useCallback(() => {
    if (!gisReadyRef.current) {
      setSyncError("Google認証が初期化されていません。ページを再読み込みしてください。");
      return;
    }
    setSilentRestoreFailed(false);
    requestAccessToken("consent");
  }, []);

  // アカウント再同意（再認証）— 既ログイン時でも consent 画面を再表示
  const relogin = useCallback(() => {
    if (!gisReadyRef.current) return;
    setSilentRestoreFailed(false);
    requestAccessToken("consent");
  }, []);

  // Storage Access API でサードパーティCookieの許可をブラウザに要求
  const requestCookieAccess = useCallback(async (): Promise<boolean> => {
    try {
      if (typeof document.requestStorageAccess === "function") {
        await document.requestStorageAccess();
        toast.success("Cookieへのアクセスが許可されました。再ログインをお試しください。");
        return true;
      } else {
        toast.info("このブラウザはStorage Access APIに対応していません。ブラウザの設定でサードパーティCookieを許可してください。");
        return false;
      }
    } catch {
      toast.error("Cookieへのアクセスが拒否されました。ブラウザの設定でサードパーティCookieを許可してください。");
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
    revokeToken();
    setIsLoggedIn(false);
    setSyncStatus("idle");
    setLastSyncedAt(null);
    setSyncError(null);
    setBackupStatus("idle");
    setLastBackupAt(null);
    setBackupError(null);
    localStorage.removeItem(LOGGED_IN_KEY);
  }, []);

  const syncToDrive = useCallback(
    async (file: TimetableFile, allOps: unknown[]) => {
      if (!isTokenValid()) {
        setSyncError("ログインが必要です");
        return;
      }
      setSyncStatus("syncing");
      setSyncError(null);
      try {
        const fileWithOps = { ...file, semesters: file.semesters?.map((s, i) => i === 0 ? { ...s, allOps } : s) ?? [] };
        const content = serializeTimetableFile(fileWithOps as TimetableFile);
        await uploadToDrive(content);
        setSyncStatus("synced");
        setLastSyncedAt(new Date());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSyncError(msg);
        setSyncStatus("error");
      }
    },
    []
  );

  const loadFromDrive = useCallback(async (): Promise<{
    file: TimetableFile;
    warnings: string[];
  } | null> => {
    if (!isTokenValid()) {
      setSyncError("ログインが必要です");
      return null;
    }
    setSyncStatus("syncing");
    setSyncError(null);
    try {
      const fileId = await findDriveFile();
      if (!fileId) {
        setSyncStatus("idle");
        return null;
      }
      const content = await downloadFromDrive(fileId);
      const result = deserializeTimetableFile(content);
      setSyncStatus("synced");
      setLastSyncedAt(new Date());
      return { file: result.file, warnings: result.warnings };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSyncError(msg);
      setSyncStatus("error");
      return null;
    }
  }, []);

  // 【手動バックアップ】マイドライブ/時間割管理/ に日付付きファイルを作成
  const backupToMyDrive = useCallback(
    async (
      file: TimetableFile,
      allOps: unknown[]
    ): Promise<{ fileName: string; folderName: string } | null> => {
      if (!isTokenValid()) {
        setBackupError("ログインが必要です");
        return null;
      }
      setBackupStatus("backing_up");
      setBackupError(null);
      try {
        const fileWithOps = {
          ...file,
          semesters: file.semesters?.map((s, i) =>
            i === 0 ? { ...s, allOps } : s
          ) ?? [],
        };
        const content = serializeTimetableFile(fileWithOps as TimetableFile);
        const titleHint = file.meta?.title ?? "時間割";
        const result = await backupToDrive(content, titleHint);
        setBackupStatus("done");
        setLastBackupAt(new Date());
        return { fileName: result.fileName, folderName: result.folderName };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setBackupError(msg);
        setBackupStatus("error");
        return null;
      }
    },
    []
  );

  // バックアップファイル一覧を取得
  const getBackupFiles = useCallback(async (): Promise<BackupFile[]> => {
    if (!isTokenValid()) return [];
    return await listBackupFiles();
  }, []);

  const hasDriveFile = useCallback(async (): Promise<boolean> => {
    if (!isTokenValid()) return false;
    try {
      const id = await findDriveFile();
      return !!id;
    } catch {
      return false;
    }
  }, []);

  return (
    <GoogleDriveContext.Provider
      value={{
        isLoggedIn,
        isRestoringLogin,
        silentRestoreFailed,
        relogin,
        requestCookieAccess,
        syncStatus,
        lastSyncedAt,
        syncError,
        backupStatus,
        lastBackupAt,
        backupError,
        login,
        logout,
        syncToDrive,
        backupToMyDrive,
        loadFromDrive,
        getBackupFiles,
        hasDriveFile,
      }}
    >
      {children}
    </GoogleDriveContext.Provider>
  );
}
