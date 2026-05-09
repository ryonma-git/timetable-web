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
  /** 自動同期ステータス（appDataFolder） */
  syncStatus: SyncStatus;
  lastSyncedAt: Date | null;
  syncError: string | null;
  /** 手動バックアップステータス（マイドライブ） */
  backupStatus: BackupStatus;
  lastBackupAt: Date | null;
  backupError: string | null;
  login: () => void;
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>("idle");
  const [lastBackupAt, setLastBackupAt] = useState<Date | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const gisReadyRef = useRef(false);

  // Initialize GIS when the script is loaded
  useEffect(() => {
    const tryInit = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gis = (window as any).google as { accounts?: unknown } | undefined;
      if (!gis?.accounts) return false;
      initGoogleAuth(
        (token) => {
          if (token) {
            setIsLoggedIn(true);
            localStorage.setItem(LOGGED_IN_KEY, "1");
          }
        },
        (err) => {
          console.error("GIS auth error:", err);
          setSyncError(err);
        }
      );
      gisReadyRef.current = true;
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
    if (!gisReadyRef.current) return;
    const wasLoggedIn = localStorage.getItem(LOGGED_IN_KEY) === "1";
    if (wasLoggedIn && !isTokenValid()) {
      // Silent token refresh (no popup)
      try {
        requestAccessToken("");
      } catch {
        // Ignore — user will need to log in manually
      }
    }
  }, [gisReadyRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(() => {
    if (!gisReadyRef.current) {
      setSyncError("Google認証が初期化されていません。ページを再読み込みしてください。");
      return;
    }
    requestAccessToken("consent");
  }, []);

  const logout = useCallback(() => {
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
