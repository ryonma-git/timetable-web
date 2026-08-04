// 同期状態インジケータ（ヘッダー常設）。
// スマホで「いま最新か」が一目で分かることが狙い。タップで設定/手動操作を開く。
// 同期OFFのときは何も出さない（既存UIを邪魔しない）。

import { useState } from "react";
import { Cloud, CloudOff, Loader2, AlertTriangle, Check } from "lucide-react";
import { useSync } from "@/contexts/SyncContext";
import { SyncSettingsDialog } from "@/components/SyncSettingsDialog";

export function SyncIndicator() {
  const sync = useSync();
  const [open, setOpen] = useState(false);
  if (!sync.config.enabled) return null;

  const busy = sync.state === "pulling" || sync.state === "pushing" || sync.state === "checking";
  const bad = sync.state === "offline" || sync.state === "error";

  const cls = busy
    ? "bg-sky-50 text-sky-700 border-sky-200"
    : bad
      ? "bg-rose-50 text-rose-600 border-rose-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";

  const label = busy
    ? sync.state === "pushing"
      ? "送信中"
      : "同期中"
    : bad
      ? "未接続"
      : "同期済み";

  const icon = busy ? (
    <Loader2 size={10} className="animate-spin shrink-0" />
  ) : bad ? (
    sync.state === "error" ? (
      <AlertTriangle size={10} className="shrink-0" />
    ) : (
      <CloudOff size={10} className="shrink-0" />
    )
  ) : (
    <Check size={10} className="shrink-0" />
  );

  const title = sync.message
    ? `スマホ連動: ${label} — ${sync.message}`
    : `スマホ連動: ${label}${sync.serverVersion ? `（サーバ版 v${sync.serverVersion}）` : ""}`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={`flex items-center gap-1 text-xs rounded px-1.5 py-0.5 border shrink-0 transition-colors hover:opacity-80 ${cls}`}
      >
        {icon}
        {/* 狭い画面ではアイコンのみ */}
        <span className="hidden sm:inline">{label}</span>
        <Cloud size={10} className="sm:hidden shrink-0" />
      </button>
      <SyncSettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
