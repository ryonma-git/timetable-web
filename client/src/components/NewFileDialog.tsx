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

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewFileDialog({ open, onClose }: Props) {
  const { loadTimetableFile } = useTimetable();
  const [title, setTitle] = useState("時間割");
  const [school, setSchool] = useState("");
  const [year, setYear] = useState(new Date().getFullYear() + "年度");
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
            新規時間割を作成
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-sm">タイトル <span className="text-destructive">*</span></Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例: ○○小学校 時間割"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="school" className="text-sm">学校名</Label>
              <Input
                id="school"
                value={school}
                onChange={e => setSchool(e.target.value)}
                placeholder="例: ○○小学校"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="year" className="text-sm">年度</Label>
              <Input
                id="year"
                value={year}
                onChange={e => setYear(e.target.value)}
                placeholder="例: 2025年度"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate" className="text-sm">開始日</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate" className="text-sm">終了日</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="bg-muted/40 rounded-md p-3 text-xs text-muted-foreground">
            <p>指定した期間の平日（月〜金）に対して、1〜6限の空きコマが自動生成されます。</p>
            <p className="mt-1">授業は後から週間グリッドで追加・編集できます。</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!title || !startDate || !endDate || loading}
            className="gap-1.5"
          >
            <FilePlus size={13} />
            {loading ? "作成中..." : "作成"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
