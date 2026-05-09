// Design: Swiss Grid × Japanese Functional Design
// DriveBackupDialog: マイドライブのバックアップ一覧を表示し、選択したファイルを復元するダイアログ

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, HardDrive, RefreshCw, RotateCcw, AlertCircle, CheckCircle2, FileText, Trash2 } from "lucide-react";
import { listBackupFiles, downloadFromDrive, deleteDriveFile, isTokenValid } from "@/lib/googleDrive";
import { useGoogleDrive } from "@/contexts/GoogleDriveContext";
import { useTimetable } from "@/contexts/TimetableContext";
import type { TimetableFile } from "@/lib/timetableFile";

interface BackupFile {
  id: string;
  name: string;
  modifiedTime: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DriveBackupDialog({ open, onClose }: Props) {
  const { isLoggedIn, login } = useGoogleDrive();
  const { loadTimetableFile } = useTimetable();

  const [files, setFiles] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null); // fileId being restored
  const [restored, setRestored] = useState<string | null>(null);   // fileId just restored
  const [confirmRestore, setConfirmRestore] = useState<BackupFile | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BackupFile | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!isLoggedIn || !isTokenValid()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listBackupFiles();
      setFiles(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (open && isLoggedIn) {
      fetchFiles();
    }
  }, [open, isLoggedIn, fetchFiles]);

  const handleRestore = useCallback(async (file: BackupFile) => {
    setConfirmRestore(null);
    setRestoring(file.id);
    setError(null);
    try {
      const content = await downloadFromDrive(file.id);
      const parsed = JSON.parse(content) as TimetableFile;
      await loadTimetableFile(parsed);
      setRestored(file.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "復元に失敗しました");
    } finally {
      setRestoring(null);
    }
  }, [loadTimetableFile]);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("ja-JP", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const handleDelete = async (file: BackupFile) => {
    setDeleting(file.id);
    setConfirmDelete(null);
    try {
      await deleteDriveFile(file.id);
      setFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (e) {
      alert("削除に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg w-[95vw] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <HardDrive size={15} className="text-amber-400" />
            Driveバックアップ一覧
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 flex-1 overflow-y-auto max-h-[60vh]">
          {!isLoggedIn ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">Googleにログインするとバックアップ一覧を表示できます</p>
              <Button size="sm" onClick={login} className="gap-1.5">Googleでログイン</Button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
              <Loader2 size={16} className="animate-spin" />
              読み込み中...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertCircle size={20} className="text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
              <Button size="sm" variant="outline" onClick={fetchFiles} className="gap-1.5 mt-1">
                <RefreshCw size={13} />
                再試行
              </Button>
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <FileText size={24} className="opacity-40" />
              <p className="text-sm">バックアップファイルがありません</p>
              <p className="text-xs">サイドバーの「マイドライブにバックアップ」でバックアップを作成できます</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">{files.length}件のバックアップ</p>
                <button
                  onClick={fetchFiles}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <RefreshCw size={11} />
                  更新
                </button>
              </div>
              {files.map(file => (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 rounded border border-border bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(file.modifiedTime)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {restored === file.id ? (
                      <span className="flex items-center gap-1 text-xs text-green-500">
                        <CheckCircle2 size={12} />
                        復元済み
                      </span>
                    ) : restoring === file.id ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" />
                        復元中...
                      </span>
                    ) : confirmRestore?.id === file.id ? (
                      <>
                        <span className="text-xs text-amber-400">現在のデータが上書きされます</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRestore(file)}
                          className="h-6 text-xs px-2"
                        >
                          復元する
                        </Button>
                        <button
                          onClick={() => setConfirmRestore(null)}
                          className="text-xs text-muted-foreground hover:text-foreground underline"
                        >
                          キャンセル
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmRestore(file)}
                          disabled={!!restoring || !!deleting}
                          className="h-6 text-xs px-2 gap-1"
                        >
                          <RotateCcw size={11} />
                          復元
                        </Button>
                        {confirmDelete?.id === file.id ? (
                          <>
                            <span className="text-xs text-red-400">削除しますか？</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDelete(file)}
                              className="h-6 text-xs px-2"
                            >
                              削除
                            </Button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-xs text-muted-foreground hover:text-foreground underline"
                            >
                              キャンセル
                            </button>
                          </>
                        ) : deleting === file.id ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 size={11} className="animate-spin" />
                            削除中...
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(file)}
                            disabled={!!restoring || !!deleting}
                            className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40"
                            title="このバックアップを削除"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border bg-background shrink-0 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>閉じる</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
