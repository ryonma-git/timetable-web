// Design: Swiss Grid × Japanese Functional Design
// Auto-restore dialog: shown on app startup when localStorage has saved data

import { useEffect, useState } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { useSync } from "@/contexts/SyncContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { deserializeTimetableFile } from "@/lib/timetableFile";
import { applyOverrides } from "@/lib/timetable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, X } from "lucide-react";

const LS_KEY = "timetable_autosave";
const LS_META_KEY = "timetable_autosave_meta";

interface SavedMeta {
  title: string;
  savedAt: string;
  filename: string;
}

export function AutoRestoreDialog() {
  const { isLoaded, loadTimetableFile } = useTimetable();
  const { language, t } = useLanguage();
  const { config: syncConfig } = useSync();
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<SavedMeta | null>(null);

  useEffect(() => {
    // Only show if no data is currently loaded
    if (isLoaded) return;
    // スマホ連動が有効なときは出さない。
    // 同期はサーバの最新を自動で取り込むので、ここでローカルの復元を挟むと
    // 「どちらが正か」が競合し、復元を選ぶと同期側が『未送信あり』と誤認する。
    if (syncConfig.enabled) return;

    try {
      const raw = localStorage.getItem(LS_KEY);
      const rawMeta = localStorage.getItem(LS_META_KEY);
      if (!raw || !rawMeta) return;

      const parsedMeta: SavedMeta = JSON.parse(rawMeta);
      setMeta(parsedMeta);
      setOpen(true);
    } catch {
      // Invalid data - ignore
    }
  }, [isLoaded, syncConfig.enabled]);

  const handleRestore = async () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const result = deserializeTimetableFile(raw);
      await loadTimetableFile(result.file);
      setOpen(false);
    } catch (e) {
      console.error("Restore failed:", e);
      setOpen(false);
    }
  };

  const handleDiscard = () => {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_META_KEY);
    setOpen(false);
  };

  if (!meta) return null;

  const savedAt = (() => {
    try {
      const d = new Date(meta.savedAt);
      return d.toLocaleString(language === "ja" ? "ja-JP" : "en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return meta.savedAt;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw size={18} className="text-primary" />
            {t("autoRestore.title")}
          </DialogTitle>
          <DialogDescription className="pt-2 space-y-1 text-sm">
            {t("autoRestore.description")}
          </DialogDescription>
          <div className="mt-3 bg-muted rounded-lg px-4 py-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("autoRestore.fileName")}</span>
              <span className="font-medium text-foreground">{meta.title}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("autoRestore.lastSaved")}</span>
              <span className="font-medium text-foreground">{savedAt}</span>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleDiscard}
          >
            <X size={14} />
            {t("autoRestore.discard")}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleRestore}
          >
            <RotateCcw size={14} />
            {t("autoRestore.restore")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
