// スマホ連動（自宅サーバ同期）の設定ダイアログ。
// Mac: 「このMacから自動設定」でトークンを取得しON。
// iPhone: サーバURL（例 Tailsc="http://mac-mini:3000"）とトークンを入力してON。

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Smartphone, Upload, Download, Wand2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useSync } from "@/contexts/SyncContext";

interface Props {
  open: boolean;
  onClose: () => void;
}

const stateLabel: Record<string, string> = {
  idle: "待機",
  checking: "確認中…",
  pulling: "取得中…",
  pushing: "送信中…",
  synced: "同期済み",
  offline: "未接続",
  error: "エラー",
  conflict: "競合",
};

export function SyncSettingsDialog({ open, onClose }: Props) {
  const sync = useSync();
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setServerUrl(sync.config.serverUrl);
      setToken(sync.config.token);
      void sync.checkHealth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const saveField = () => {
    sync.updateConfig({ serverUrl, token });
  };

  const onAutoConfigure = async () => {
    setBusy(true);
    saveField();
    const ok = await sync.autoConfigureFromLocal();
    setBusy(false);
    if (ok) {
      setToken(sync.config.token || "");
      toast.success("このMacからトークンを取得しました");
      await sync.checkHealth();
    } else {
      toast.error("自動設定はこのアプリと同じPC（サーバ同居）でのみ可能です");
    }
  };

  const reach =
    sync.reachable === null ? null : sync.reachable ? (
      <span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5" /> サーバ接続OK
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-rose-600 text-xs">
        <XCircle className="h-3.5 w-3.5" /> 未接続
      </span>
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            スマホ連動（自宅サーバ同期）
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 有効化 */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">同期を有効にする</div>
              <div className="text-xs text-muted-foreground">
                保存時に自動送信し、開いた時に最新を取得します
              </div>
            </div>
            <Switch
              checked={sync.config.enabled}
              onCheckedChange={(v) => {
                saveField();
                sync.updateConfig({ enabled: v });
              }}
            />
          </div>

          {/* サーバURL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              サーバURL（空欄=このアプリと同じ場所。iPhoneからは例「http://mac-mini:3000」）
            </label>
            <Input
              placeholder="（同一オリジン）"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              onBlur={saveField}
            />
          </div>

          {/* トークン */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">同期トークン</label>
            <div className="flex gap-2">
              <Input
                placeholder="サーバのトークン"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onBlur={saveField}
                className="font-mono text-xs"
              />
              <Button variant="outline" size="sm" onClick={onAutoConfigure} disabled={busy} className="shrink-0 gap-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                このMacから
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              iPhone では、Mac で表示されたこのトークンをそのまま入力してください（トークンは
              サーバの <code>.sync-data/token.txt</code> にもあります）。
            </p>
          </div>

          {/* 状態 + 手動操作 */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
            <div className="text-sm">
              <span className="font-medium">{stateLabel[sync.state] ?? sync.state}</span>
              {sync.serverVersion > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">サーバ版 v{sync.serverVersion}</span>
              )}
              <div className="mt-0.5">{reach}</div>
              {sync.message && <div className="text-xs text-muted-foreground mt-0.5">{sync.message}</div>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={() => sync.pushNow()}>
                <Upload className="h-4 w-4" /> 送信
              </Button>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => sync.pullNow()}>
                <Download className="h-4 w-4" /> 取得
              </Button>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            児童に関わる記述を含みうるため、外部クラウドではなく自宅サーバでの運用を想定しています。
            外部公開する場合は Tailscale などの閉じた経路を推奨します。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
