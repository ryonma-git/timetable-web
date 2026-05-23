// NewFileDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// New timetable creation dialog

import { useState } from "react";
import { FilePlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateBaseEntries, createNewTimetableFile } from "@/lib/timetableFile";
import { useTimetable } from "@/contexts/TimetableContext";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/contexts/LanguageContext";

function wfn(t: (k: TranslationKey) => string, key: TranslationKey, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewFileDialog({ open, onClose }: Props) {
  const { loadTimetableFile } = useTimetable();
  const { t } = useLanguage();
  const [title, setTitle] = useState(() => t("nfd.defaultTitle"));
  const [school, setSchool] = useState("");
  const [year, setYear] = useState(() => wfn(t, "nfd.defaultYear", { y: new Date().getFullYear() }));
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(3); d.setDate(1); // April 1
    return d.getFullYear() + "-04-01";
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y + 1}-03-31`;
  });
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const base = generateBaseEntries(startDate, endDate, {});
      const file = createNewTimetableFile(title, school || undefined, year || undefined);
      file.base = base;
      await loadTimetableFile(file);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus size={18} />
            {t("nfd.dialogTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-sm">{t("nfd.titleLabel")} <span className="text-destructive">*</span></Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t("nfd.titlePh")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="school" className="text-sm">{t("nfd.schoolLabel")}</Label>
              <Input
                id="school"
                value={school}
                onChange={e => setSchool(e.target.value)}
                placeholder={t("nfd.schoolPh")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="year" className="text-sm">{t("nfd.yearLabel")}</Label>
              <Input
                id="year"
                value={year}
                onChange={e => setYear(e.target.value)}
                placeholder={t("nfd.yearPh")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate" className="text-sm">{t("nfd.startLabel")}</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate" className="text-sm">{t("nfd.endLabel")}</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="bg-muted/40 rounded-md p-3 text-xs text-muted-foreground">
            <p>{t("nfd.hint1")}</p>
            <p className="mt-1">{t("nfd.hint2")}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("nfd.cancelBtn")}
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!title || !startDate || !endDate || loading}
            className="gap-1.5"
          >
            <FilePlus size={13} />
            {loading ? t("nfd.creating") : t("nfd.createBtn")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
