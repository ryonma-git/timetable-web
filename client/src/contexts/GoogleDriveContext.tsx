// GoogleDriveContext: manages Google Drive login state and auto-sync
// Uses GIS implicit token flow (client_id only, no client_secret in frontend)

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

export interface GoogleDriveContextValue {
  isLoggedIn: boolean;
  syncStatus: SyncStatus;
  lastSyncedAt: Date | null;
  syncError: string | null;
  login: () => void;
  logout: () => void;
  /** Upload current file to Drive */
  syncToDrive: (file: TimetableFile, allOps: unknown[]) => Promise<void>;
  /** Download from Drive and return parsed file */
  loadFromDrive: () => Promise<{ file: TimetableFile; warnings: string[] } | null>;
  /** Check if Drive has a saved file */
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
        login,
        logout,
        syncToDrive,
        loadFromDrive,
        hasDriveFile,
      }}
    >
      {children}
    </GoogleDriveContext.Provider>
  );
}
