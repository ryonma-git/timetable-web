// Google Drive「サーバー経由ログイン」の案内・操作（サイドバー用の小さな行）。
// サーバーが未設定の環境（Vercel等・GOOGLE_CLIENT_SECRET未設定）では何も表示しない。
// 既存のGISログインUIには手を入れず、この行を追加するだけに留める。

import { useEffect, useState } from "react";
import { Link2, Loader2, Unlink } from "lucide-react";
import { fetchDriveServerStatus, startDriveServerLink, unlinkDriveServer } from "@/lib/driveServerAuth";

export function DriveServerLinkRow() {
  const [status, setStatus] = useState<{ configured: boolean; linked: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void fetchDriveServerStatus().then(setStatus);
  };
  useEffect(() => {
    refresh();
  }, []);

  if (!status || !status.configured) return null; // 未設定の環境では出さない

  if (status.linked) {
    return (
      <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px]">
        <span className="flex items-center gap-1.5">
          <Link2 size={11} />
          サーバー連携済み（再ログイン不要）
        </span>
        <button
          onClick={async () => {
            setBusy(true);
            await unlinkDriveServer();
            refresh();
            setBusy(false);
          }}
          disabled={busy}
          className="text-emerald-400/70 hover:text-emerald-300 shrink-0"
          title="連携を解除"
        >
          <Unlink size={11} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={async () => {
        setBusy(true);
        const r = await startDriveServerLink();
        setBusy(false);
        if (r.ok) {
          // 別タブでの認可完了を待って自動反映（ポーリングは短時間だけ）
          let tries = 0;
          const id = setInterval(() => {
            tries += 1;
            fetchDriveServerStatus().then((s) => {
              if (s.linked || tries > 30) {
                clearInterval(id);
                setStatus(s);
              }
            });
          }, 2000);
        }
      }}
      disabled={busy}
      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md
                 bg-sidebar-accent hover:bg-sidebar-accent/80 text-sidebar-foreground/60
                 text-[10px] transition-colors duration-150 border border-sidebar-border"
      title="1回だけログインすれば、以後は自動更新されログインを求められなくなります"
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
      サーバー経由でログインを維持（再ログイン不要に）
    </button>
  );
}
