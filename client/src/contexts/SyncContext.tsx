// 時間割スナップショット同期のContext。
// - 起動/有効化時: サーバの最新を取得し、サーバが新しければ取り込む（自動プル）。
// - 保存(currentFile変更)時: debounceして送信（自動プッシュ）。
// - 競合(409)は last-write-wins（updatedAtで新しい方を採用）を既定にしつつ状態で通知。
//
// 既存のGoogle Drive同期とは独立。同期先は「なし/自宅サーバ(本機能)」を任意で選ぶ想定。

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTimetable } from "./TimetableContext";
import {
  getSyncConfig,
  setSyncConfig as persistConfig,
  syncHealth,
  bootstrapToken,
  pullSnapshot,
  pushSnapshot,
  forcePush,
  isNewer,
  validateSnapshotPayload,
  SyncError,
  type SyncConfig,
} from "@/lib/timetableSync";

export type SyncState = "idle" | "checking" | "pulling" | "pushing" | "synced" | "offline" | "error" | "conflict";

interface SyncContextValue {
  config: SyncConfig;
  state: SyncState;
  lastSyncedAt: string | null;
  serverVersion: number;
  message: string;
  reachable: boolean | null;
  updateConfig: (patch: Partial<SyncConfig>) => void;
  autoConfigureFromLocal: () => Promise<boolean>; // Macからトークン自動取得
  checkHealth: () => Promise<void>;
  pullNow: () => Promise<void>;
  pushNow: () => Promise<void>;
}

const Ctx = createContext<SyncContextValue | null>(null);
export const useSync = (): SyncContextValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSync must be used within SyncProvider");
  return v;
};

const PUSH_DEBOUNCE_MS = 2500;
/** 表示中の定期プル間隔。短すぎると電池と通信を食うので控えめに。 */
const POLL_INTERVAL_MS = 60_000;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { currentFile, loadTimetableFile } = useTimetable();
  const [config, setConfig] = useState<SyncConfig>(() => getSyncConfig());
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState(0);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedUpdatedAt = useRef<string | null>(null);
  const didInitialPull = useRef(false);

  const updateConfig = useCallback((patch: Partial<SyncConfig>) => {
    persistConfig(patch);
    setConfig(getSyncConfig());
  }, []);

  const autoConfigureFromLocal = useCallback(async () => {
    const ok = await bootstrapToken();
    if (ok) setConfig(getSyncConfig());
    return ok;
  }, []);

  const checkHealth = useCallback(async () => {
    setState("checking");
    const h = await syncHealth();
    setReachable(h.ok);
    setServerVersion(h.version ?? 0);
    setState(h.ok ? "idle" : "offline");
    setMessage(h.ok ? "" : "サーバに接続できません");
  }, []);

  // サーバ最新を取り込む（ローカルより新しければ）
  const pullNow = useCallback(async () => {
    try {
      setState("pulling");
      const remote = await pullSnapshot();
      setReachable(true);
      if (!remote) {
        setState("synced");
        setMessage("サーバにデータはまだありません");
        return;
      }
      setServerVersion(remote.version);
      // 壊れた/古い形式を取り込むとアプリ側で例外になるため、先に検証して弾く
      const v = validateSnapshotPayload(remote.payload);
      if (!v.ok) {
        setState("error");
        setMessage(`サーバのデータを取り込めません（${v.reason}）。Macから「送信」し直してください`);
        return;
      }
      const localUpdated = currentFile?.meta?.updatedAt;
      if (isNewer(remote.updatedAt, localUpdated) || !currentFile) {
        await loadTimetableFile(remote.payload);
        lastPushedUpdatedAt.current = remote.updatedAt;
        setLastSyncedAt(new Date().toISOString());
        setState("synced");
        setMessage(`サーバの最新を取り込みました（${remote.device ?? "他端末"}）`);
        toast.success("スマホ/他端末の最新を取り込みました");
      } else {
        setState("synced");
        setMessage("ローカルが最新です");
      }
    } catch (e) {
      handleErr(e);
    }
  }, [currentFile, loadTimetableFile]);

  const pushNow = useCallback(async () => {
    if (!currentFile) return;
    try {
      setState("pushing");
      const r = await pushSnapshot(currentFile);
      setReachable(true);
      if (r.ok) {
        setServerVersion(r.version);
        lastPushedUpdatedAt.current = currentFile.meta?.updatedAt ?? null;
        setLastSyncedAt(new Date().toISOString());
        setState("synced");
        setMessage("送信しました");
      } else {
        // 競合: サーバの方が新しいことがある。updatedAtで判定して last-write-wins。
        const remote = await pullSnapshot();
        const rv = remote ? validateSnapshotPayload(remote.payload) : { ok: false as const, reason: "データなし" };
        if (remote && rv.ok && isNewer(remote.updatedAt, currentFile.meta?.updatedAt)) {
          await loadTimetableFile(remote.payload);
          setServerVersion(remote.version);
          setState("synced");
          setMessage("サーバが新しかったため取り込みました");
          toast.info("サーバ側が新しかったので取り込みました");
        } else {
          const f = await forcePush(currentFile, r.serverVersion);
          if (f.ok) {
            setServerVersion(f.version);
            setState("synced");
            setMessage("上書き送信しました");
          }
        }
      }
    } catch (e) {
      handleErr(e);
    }
  }, [currentFile, loadTimetableFile]);

  const handleErr = (e: unknown) => {
    if (e instanceof SyncError && e.code === "unauthorized") {
      setState("error");
      setMessage("同期トークンが正しくありません");
    } else {
      setReachable(false);
      setState("offline");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  // 有効化時: 一度だけ自動プル
  useEffect(() => {
    if (!config.enabled) {
      didInitialPull.current = false;
      return;
    }
    if (didInitialPull.current) return;
    didInitialPull.current = true;
    void pullNow();
  }, [config.enabled, pullNow]);

  // 保存(currentFile.updatedAt変更)時: debounceして自動プッシュ
  useEffect(() => {
    if (!config.enabled || !currentFile) return;
    const u = currentFile.meta?.updatedAt;
    if (!u || u === lastPushedUpdatedAt.current) return; // 取り込み直後や無変更はスキップ
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushNow();
    }, PUSH_DEBOUNCE_MS);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [currentFile, config.enabled, pushNow]);

  // フォアグラウンド復帰時: 最新を取りに行く（スマホで開き直した時に効く）
  useEffect(() => {
    if (!config.enabled) return;
    const onVis = () => {
      if (document.visibilityState === "visible") void pullNow();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [config.enabled, pullNow]);

  // オンライン復帰時: すぐ再同期（電波が戻った瞬間に最新へ追いつく）
  useEffect(() => {
    if (!config.enabled) return;
    const onOnline = () => void pullNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [config.enabled, pullNow]);

  // 定期プル: 表示中のみ一定間隔で最新を確認（他端末の編集を放置しても追いつく）。
  // 非表示中はタイマーを動かさない（電池とリクエストの無駄を避ける）。
  useEffect(() => {
    if (!config.enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void pullNow();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [config.enabled, pullNow]);

  return (
    <Ctx.Provider
      value={{
        config,
        state,
        lastSyncedAt,
        serverVersion,
        message,
        reachable,
        updateConfig,
        autoConfigureFromLocal,
        checkHealth,
        pullNow,
        pushNow,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
