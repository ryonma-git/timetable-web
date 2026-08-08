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
  autoConfigureFromLocal: () => Promise<string | null>; // Macからトークン自動取得。取得できたトークンをそのまま返す
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

const PUSH_DEBOUNCE_MS = 1200;
/** 表示中の定期プル間隔。短すぎると電池と通信を食うので控えめに。 */
const POLL_INTERVAL_MS = 60_000;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { currentFile, loadTimetableFile, allOps } = useTimetable();

  // ★重要: コマの編集は allOps に入り、currentFile.ops は「保存」するまで更新されない。
  // そのため currentFile だけを送ると編集が含まれず、変更が同期されない（実機で発生）。
  // ここで「未保存の編集も含んだ状態」を組み立て、これを同期の対象とする。
  const lastEditAt = useRef<string | null>(null);
  const prevOpsLen = useRef<number>(-1);
  if (allOps.length !== prevOpsLen.current) {
    if (prevOpsLen.current !== -1) lastEditAt.current = new Date().toISOString();
    prevOpsLen.current = allOps.length;
  }
  const syncFile = (() => {
    if (!currentFile) return null;
    const savedLen = currentFile.ops?.length ?? 0;
    if (allOps.length === savedLen) return currentFile; // 未保存の編集なし
    return {
      ...currentFile,
      ops: allOps,
      meta: { ...currentFile.meta, updatedAt: lastEditAt.current ?? currentFile.meta.updatedAt },
    };
  })();
  const [config, setConfig] = useState<SyncConfig>(() => getSyncConfig());
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState(0);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedUpdatedAt = useRef<string | null>(null);
  const didInitialPull = useRef(false);
  /** まだサーバへ送れていない編集があるか（画面を離れる直前の送り切り＆再開時の送り直しに使う） */
  const hasUnsent = useRef(false);
  /** pullNow から pushNow を呼ぶための参照（相互依存を避ける） */
  const pushNowRef = useRef<(() => Promise<void>) | null>(null);

  const updateConfig = useCallback((patch: Partial<SyncConfig>) => {
    persistConfig(patch);
    setConfig(getSyncConfig());
  }, []);

  const autoConfigureFromLocal = useCallback(async () => {
    const token = await bootstrapToken();
    if (token) setConfig(getSyncConfig());
    return token;
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
      const localUpdated = syncFile?.meta?.updatedAt;
      // ★安全装置: 未送信のローカル編集がある間は、サーバが新しくても絶対に上書きしない。
      // （実機で「iPhoneの編集が消える」事故が起きたため。まず送ってから取り込む）
      if (hasUnsent.current && syncFile) {
        // 未送信のローカル編集がある。黙って上書きせず、まず送る（メモアプリのように
        // 利用者が意識しなくても解消される）。送信できれば以後は普通に取り込める。
        setMessage("未送信の変更を先に送ります");
        await pushNowRef.current?.();
        if (hasUnsent.current) {
          // 送信できなかった場合だけ手動対応を促す
          setState("conflict");
          setMessage("未送信の変更があります。「送信」をお試しください");
        }
        return;
      }
      if (isNewer(remote.updatedAt, localUpdated) || !syncFile) {
        await loadTimetableFile(remote.payload);
        lastPushedUpdatedAt.current = remote.updatedAt;
        hasUnsent.current = false;
        setLastSyncedAt(new Date().toISOString());
        setState("synced");
        setMessage(`サーバの最新を取り込みました（${remote.device ?? "他端末"}）`);
        toast.success("スマホ/他端末の最新を取り込みました");
      } else if (hasUnsent.current) {
        // ローカルの方が新しい＝前回送り切れなかった変更が残っている。
        // 取得のついでに送り直す（アプリを開くたびに未送信が解消される安全網）。
        setMessage("未送信の変更を送ります");
        await pushNowRef.current?.();
      } else {
        setState("synced");
        setMessage("ローカルが最新です");
      }
    } catch (e) {
      handleErr(e);
    }
  }, [syncFile, loadTimetableFile]);

  const pushNow = useCallback(async () => {
    if (!syncFile) return;
    try {
      setState("pushing");
      const r = await pushSnapshot(syncFile);
      setReachable(true);
      if (r.ok) {
        setServerVersion(r.version);
        lastPushedUpdatedAt.current = syncFile.meta?.updatedAt ?? null;
        hasUnsent.current = false;
        setLastSyncedAt(new Date().toISOString());
        setState("synced");
        setMessage("送信しました");
      } else {
        // 競合: サーバの方が新しいことがある。updatedAtで判定して last-write-wins。
        const remote = await pullSnapshot();
        const rv = remote ? validateSnapshotPayload(remote.payload) : { ok: false as const, reason: "データなし" };
        if (remote && rv.ok && isNewer(remote.updatedAt, syncFile.meta?.updatedAt)) {
          await loadTimetableFile(remote.payload);
          setServerVersion(remote.version);
          setState("synced");
          setMessage("サーバが新しかったため取り込みました");
          toast.info("サーバ側が新しかったので取り込みました");
        } else {
          const f = await forcePush(syncFile, r.serverVersion);
          if (f.ok) {
            setServerVersion(f.version);
            hasUnsent.current = false;
            setState("synced");
            setMessage("上書き送信しました");
          }
        }
      }
    } catch (e) {
      handleErr(e);
    }
  }, [syncFile, loadTimetableFile]);

  // pullNow から呼べるように最新の pushNow を保持
  useEffect(() => {
    pushNowRef.current = pushNow;
  }, [pushNow]);

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
    if (!config.enabled || !syncFile) return;
    const u = syncFile.meta?.updatedAt;
    if (!u || u === lastPushedUpdatedAt.current) return; // 取り込み直後や無変更はスキップ
    hasUnsent.current = true; // まだ送っていない変更がある
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushNow();
    }, PUSH_DEBOUNCE_MS);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [syncFile, config.enabled, pushNow]);

  // 画面を離れる直前に未送信の変更を送り切る。
  // スマホでは編集直後にアプリを閉じる/ホームに戻ることが多く、debounce待ちのまま
  // ページが停止されると変更が失われるため（iPhoneで実際に発生）。
  useEffect(() => {
    if (!config.enabled) return;
    const flush = () => {
      if (!hasUnsent.current) return;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      void pushNow();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, [config.enabled, pushNow]);

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
