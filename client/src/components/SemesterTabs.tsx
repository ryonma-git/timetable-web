// Design: Swiss Grid × Japanese Functional Design
// SemesterTabs: 複数学期タブ切り替えUI

import { useState } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { useLanguage, type Language, type TranslationKey } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SemesterData, SemesterMeta } from "@/lib/timetableFile";
import { generateBaseEntries } from "@/lib/timetableFile";

function getSemesterLabel(meta: SemesterMeta, language: Language, t: (key: TranslationKey) => string): string {
  const system = meta.semesterSystem ?? "trimester";
  if (system === "semester") {
    return meta.semesterNumber === 1 ? t("weekGrid.firstTerm") : t("weekGrid.secondTerm");
  }
  return language === "ja" ? `${meta.semesterNumber}${t("weekGrid.termSuffix")}` : `${t("weekGrid.termSuffix")} ${meta.semesterNumber}`;
}

interface AddSemesterDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (data: SemesterData) => void;
  currentSemester: SemesterMeta | null;
}

function AddSemesterDialog({ open, onClose, onAdd, currentSemester }: AddSemesterDialogProps) {
  const { language, t } = useLanguage();
  const system = currentSemester?.semesterSystem ?? "trimester";
  const maxSemesters = system === "semester" ? 2 : 3;

  const [semesterNumber, setSemesterNumber] = useState<string>("2");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const semesterOptions = system === "semester"
    ? [{ value: "1", label: t("weekGrid.firstTerm") }, { value: "2", label: t("weekGrid.secondTerm") }]
    : [
        { value: "1", label: language === "ja" ? `1${t("weekGrid.termSuffix")}` : `${t("weekGrid.termSuffix")} 1` },
        { value: "2", label: language === "ja" ? `2${t("weekGrid.termSuffix")}` : `${t("weekGrid.termSuffix")} 2` },
        { value: "3", label: language === "ja" ? `3${t("weekGrid.termSuffix")}` : `${t("weekGrid.termSuffix")} 3` },
      ];

  const handleAdd = () => {
    if (!startDate || !endDate) return;
    const semNum = parseInt(semesterNumber) as 1 | 2 | 3;
    const newSemester: SemesterMeta = {
      ...currentSemester!,
      semesterNumber: semNum,
      startDate,
      endDate,
      holidays: [],
    };
    const base = generateBaseEntries(startDate, endDate, {
      hasSaturday: newSemester.hasSaturday,
      hasSunday: newSemester.hasSunday,
      baseSchedule: newSemester.baseSchedule,
    });
    const data: SemesterData = { semester: newSemester, base, ops: [] };
    onAdd(data);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{t("semester.add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("semester.semester")}</Label>
            <Select value={semesterNumber} onValueChange={setSemesterNumber}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {semesterOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("semester.startDate")}</Label>
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("semester.endDate")}</Label>
            <Input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("semester.copyNotice")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs h-7">
            {t("semester.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!startDate || !endDate}
            className="text-xs h-7"
          >
            {t("semester.addButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SemesterTabs() {
  const { language, t } = useLanguage();
  const {
    currentFile,
    activeSemesterIndex,
    semesterCount,
    switchToSemester,
    addSemester,
    removeSemester,
    semester,
  } = useTimetable();

  const [addDialogOpen, setAddDialogOpen] = useState(false);

  if (!currentFile || semesterCount === 0) return null;

  // Build tab labels
  const semesters = currentFile.semesters;
  if (!semesters || semesters.length <= 1) {
    const activeSemester = semester ?? semesters?.[0]?.semester ?? null;
    return (
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/30">
        {activeSemester && (
          <span className="text-xs text-muted-foreground font-medium">
            {getSemesterLabel(activeSemester, language, t)}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 gap-1 text-xs"
          onClick={() => setAddDialogOpen(true)}
        >
          <Plus size={11} />
          {t("semester.add")}
        </Button>
        <AddSemesterDialog
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          onAdd={addSemester}
          currentSemester={activeSemester}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-muted/30 overflow-x-auto">
      {semesters.map((semData, idx) => (
        <div key={idx} className="flex items-center group shrink-0">
          <button
            onClick={() => switchToSemester(idx)}
            className={cn(
              "px-3 py-1 text-xs rounded-t font-medium transition-colors",
              idx === activeSemesterIndex
                ? "bg-background text-foreground border border-b-background border-border -mb-px z-10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {getSemesterLabel(semData.semester, language, t)}
            <span className="ml-1 text-muted-foreground font-normal">
              {language === "ja"
                ? `${semData.semester.startDate?.slice(5, 7)}${t("semester.monthSuffix")}〜${semData.semester.endDate?.slice(5, 7)}${t("semester.monthSuffix")}`
                : `${semData.semester.startDate?.slice(5, 7)}-${semData.semester.endDate?.slice(5, 7)}`}
            </span>
          </button>
          {semesters.length > 1 && (
            <button
              onClick={() => removeSemester(idx)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all ml-0.5"
              title={t("semester.deleteTitle")}
            >
              <X size={10} />
            </button>
          )}
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 ml-1 text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => setAddDialogOpen(true)}
        title={t("semester.add")}
      >
        <Plus size={12} />
      </Button>
      <AddSemesterDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdd={addSemester}
        currentSemester={semester ?? semesters[activeSemesterIndex]?.semester ?? null}
      />
    </div>
  );
}
