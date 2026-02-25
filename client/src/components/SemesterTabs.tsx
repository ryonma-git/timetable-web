// Design: Swiss Grid × Japanese Functional Design
// SemesterTabs: 複数学期タブ切り替えUI

import { useState } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
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

function getSemesterLabel(meta: SemesterMeta): string {
  const system = meta.semesterSystem ?? "trimester";
  if (system === "semester") {
    return meta.semesterNumber === 1 ? "前期" : "後期";
  }
  return `${meta.semesterNumber}学期`;
}

interface AddSemesterDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (data: SemesterData) => void;
  currentSemester: SemesterMeta | null;
}

function AddSemesterDialog({ open, onClose, onAdd, currentSemester }: AddSemesterDialogProps) {
  const system = currentSemester?.semesterSystem ?? "trimester";
  const maxSemesters = system === "semester" ? 2 : 3;

  const [semesterNumber, setSemesterNumber] = useState<string>("2");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const semesterOptions = system === "semester"
    ? [{ value: "1", label: "前期" }, { value: "2", label: "後期" }]
    : [
        { value: "1", label: "1学期" },
        { value: "2", label: "2学期" },
        { value: "3", label: "3学期" },
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
          <DialogTitle className="text-sm font-semibold">学期を追加</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">学期</Label>
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
            <Label className="text-xs">始業日</Label>
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">終業日</Label>
            <Input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            基本時間割・クラス設定は現在の学期から引き継がれます。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs h-7">
            キャンセル
          </Button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!startDate || !endDate}
            className="text-xs h-7"
          >
            追加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SemesterTabs() {
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
    // Single semester: show minimal indicator
    if (!semester) return null;
    return (
      <div className="flex items-center gap-1 px-3 py-1 border-b border-border bg-muted/30">
        <span className="text-xs text-muted-foreground font-medium">
          {getSemesterLabel(semester)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 ml-1 text-muted-foreground hover:text-foreground"
          onClick={() => setAddDialogOpen(true)}
          title="学期を追加"
        >
          <Plus size={10} />
        </Button>
        <AddSemesterDialog
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          onAdd={addSemester}
          currentSemester={semester}
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
            {getSemesterLabel(semData.semester)}
            <span className="ml-1 text-muted-foreground font-normal">
              {semData.semester.startDate?.slice(5, 7)}月〜{semData.semester.endDate?.slice(5, 7)}月
            </span>
          </button>
          {semesters.length > 1 && (
            <button
              onClick={() => removeSemester(idx)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all ml-0.5"
              title="この学期を削除"
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
        title="学期を追加"
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
