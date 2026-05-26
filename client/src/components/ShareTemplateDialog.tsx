// ShareTemplateDialog.tsx
// 同僚へのデータ共有用テンプレート書き出しダイアログ
// 学校情報・クラス構成・時程表・祝日・教科リストを選択して .timetable ファイルとして書き出す

import { useState, useMemo } from "react";
import { Share2, School, Users, Clock, CalendarOff, BookOpen, Download, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTimetable } from "@/contexts/TimetableContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { TIMETABLE_FILE_VERSION } from "@/lib/timetableFile";
import type { TimetableFile, SemesterMeta } from "@/lib/timetableFile";

interface Props {
  open: boolean;
  onClose: () => void;
}

type CategoryKey = "school" | "classes" | "periods" | "holidays" | "subjects";

interface Category {
  key: CategoryKey;
  icon: React.ReactNode;
  labelJa: string;
  labelEn: string;
  descJa: string;
  descEn: string;
}

const CATEGORIES: Category[] = [
  {
    key: "school",
    icon: <School size={14} />,
    labelJa: "学校情報",
    labelEn: "School Info",
    descJa: "学校名・年度・学期制・学校種別・授業日設定",
    descEn: "School name, year, semester system, school type, schedule days",
  },
  {
    key: "classes",
    icon: <Users size={14} />,
    labelJa: "クラス構成",
    labelEn: "Class Structure",
    descJa: "学年別クラス数・全クラスリスト",
    descEn: "Class counts per grade, full class list",
  },
  {
    key: "periods",
    icon: <Clock size={14} />,
    labelJa: "時程表",
    labelEn: "Period Times",
    descJa: "各時限の開始・終了時刻",
    descEn: "Start and end times for each period",
  },
  {
    key: "holidays",
    icon: <CalendarOff size={14} />,
    labelJa: "祝日・休校日",
    labelEn: "Holidays",
    descJa: "年間の祝日・休校日リスト",
    descEn: "Annual holiday and school-off day list",
  },
  {
    key: "subjects",
    icon: <BookOpen size={14} />,
    labelJa: "教科リスト",
    labelEn: "Subject List",
    descJa: "教科名・略称",
    descEn: "Subject names and abbreviations",
  },
];

type Preset = {
  id: string;
  labelJa: string;
  labelEn: string;
  keys: CategoryKey[];
};

const PRESETS: Preset[] = [
  {
    id: "school_only",
    labelJa: "学校情報のみ",
    labelEn: "School Only",
    keys: ["school", "classes"],
  },
  {
    id: "school_schedule",
    labelJa: "学校 + 時程・祝日",
    labelEn: "School + Schedule",
    keys: ["school", "classes", "periods", "holidays"],
  },
  {
    id: "full",
    labelJa: "フルセット",
    labelEn: "Full Set",
    keys: ["school", "classes", "periods", "holidays", "subjects"],
  },
];

export function ShareTemplateDialog({ open, onClose }: Props) {
  const { currentFile, semester, subjects } = useTimetable();
  const { language } = useLanguage();
  const ja = language === "ja";

  const [selected, setSelected] = useState<Set<CategoryKey>>(
    new Set<CategoryKey>(["school", "classes", "periods", "holidays", "subjects"])
  );
  const [activePreset, setActivePreset] = useState<string>("full");

  const toggle = (key: CategoryKey) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      setActivePreset("custom");
      return next;
    });
  };

  const applyPreset = (preset: Preset) => {
    setSelected(new Set(preset.keys));
    setActivePreset(preset.id);
  };

  // 書き出すファイルのメタ情報プレビュー
  const preview = useMemo(() => {
    const school = currentFile?.meta.school ?? "";
    const year = currentFile?.meta.year ?? "";
    const parts = [school, year].filter(Boolean);
    const base = parts.length > 0 ? parts.join("_") : "template";
    return `${base}_template.timetable`;
  }, [currentFile]);

  // 含まれるデータのサマリー
  const summary = useMemo(() => {
    const lines: string[] = [];
    if (selected.has("school") && semester) {
      const sys = semester.semesterSystem === "trimester"
        ? (ja ? "3学期制" : "Trimester")
        : (ja ? "2学期制" : "Semester");
      lines.push(ja
        ? `学期制: ${sys}、土曜: ${semester.hasSaturday ? "あり" : "なし"}`
        : `System: ${sys}, Saturday: ${semester.hasSaturday ? "Yes" : "No"}`);
    }
    if (selected.has("classes") && semester?.classList) {
      lines.push(ja
        ? `クラス数: ${semester.classList.length} クラス`
        : `Classes: ${semester.classList.length}`);
    }
    if (selected.has("periods") && semester?.periodTimes) {
      const count = Object.keys(semester.periodTimes).length;
      lines.push(ja ? `時程: ${count} 時限分` : `Periods: ${count} slots`);
    }
    if (selected.has("holidays") && semester?.holidays) {
      lines.push(ja
        ? `休日・休校日: ${semester.holidays.length} 件`
        : `Holidays: ${semester.holidays.length} days`);
    }
    if (selected.has("subjects") && subjects.length > 0) {
      lines.push(ja
        ? `教科: ${subjects.length} 件`
        : `Subjects: ${subjects.length}`);
    }
    return lines;
  }, [selected, semester, subjects, ja]);

  const handleExport = () => {
    if (!currentFile) return;

    const sem = currentFile.semester ?? currentFile.semesters?.[0]?.semester;

    // 学校情報 (school)
    const baseMeta = {
      title: [currentFile.meta.school, currentFile.meta.year]
        .filter(Boolean)
        .concat(ja ? ["テンプレート"] : ["Template"])
        .join(" "),
      school: currentFile.meta.school,
      year: currentFile.meta.year,
      mode: currentFile.meta.mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // SemesterMeta の書き出し対象フィールドを選択
    let semOut: SemesterMeta | undefined = undefined;
    if (sem) {
      const base: Partial<SemesterMeta> = {};

      if (selected.has("school")) {
        base.semesterSystem = sem.semesterSystem;
        base.schoolType = sem.schoolType;
        base.hasSaturday = sem.hasSaturday;
        base.hasSunday = sem.hasSunday;
        base.semesterNumber = sem.semesterNumber;
        // 学期開始・終了日は学校情報に含める
        base.startDate = sem.startDate;
        base.endDate = sem.endDate;
      }

      if (selected.has("classes")) {
        base.gradeClassCounts = sem.gradeClassCounts;
        base.classList = sem.classList;
        base.customClasses = sem.customClasses;
      }

      if (selected.has("periods")) {
        base.periodTimes = sem.periodTimes;
        base.periodTimesByDay = sem.periodTimesByDay;
      }

      if (selected.has("holidays")) {
        base.holidays = sem.holidays;
      }

      semOut = base as SemesterMeta;
    }

    const templateFile: TimetableFile = {
      format: "timetable-app/v1",
      version: TIMETABLE_FILE_VERSION,
      meta: baseMeta,
      semester: semOut,
      base: [],
      ops: [],
      subjects: selected.has("subjects") ? (currentFile.subjects ?? []) : [],
    };

    const json = JSON.stringify(templateFile, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = preview;
    a.click();
    URL.revokeObjectURL(url);

    onClose();
  };

  const hasData = selected.size > 0 && currentFile !== null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Share2 size={16} />
            {ja ? "テンプレートを書き出す" : "Export Template"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {ja
              ? "同僚に渡すための学校情報ファイルを作成します。時間割データは含まれません。"
              : "Creates a school setup file to share with colleagues. Timetable entries are not included."}
          </p>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Presets */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {ja ? "プリセット" : "Presets"}
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded border transition-colors",
                    activePreset === p.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  )}
                >
                  {ja ? p.labelJa : p.labelEn}
                </button>
              ))}
            </div>
          </div>

          {/* Category checkboxes */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {ja ? "含めるデータ" : "Data to include"}
            </p>
            <div className="space-y-1">
              {CATEGORIES.map(cat => {
                const isOn = selected.has(cat.key);
                return (
                  <button
                    key={cat.key}
                    onClick={() => toggle(cat.key)}
                    className={cn(
                      "w-full flex items-start gap-3 px-3 py-2 rounded border text-left transition-colors",
                      isOn
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-transparent hover:border-border/80 hover:bg-muted/30"
                    )}
                  >
                    <div className={cn(
                      "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                      isOn ? "bg-primary border-primary" : "border-muted-foreground/40"
                    )}>
                      {isOn && <Check size={10} className="text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-muted-foreground", isOn && "text-primary")}>
                          {cat.icon}
                        </span>
                        <span className={cn("text-sm font-medium", isOn ? "text-foreground" : "text-muted-foreground")}>
                          {ja ? cat.labelJa : cat.labelEn}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {ja ? cat.descJa : cat.descEn}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          {summary.length > 0 && (
            <div className="bg-muted/40 rounded-md px-3 py-2.5 space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {ja ? "書き出し内容" : "Will include"}
              </p>
              {summary.map((line, i) => (
                <p key={i} className="text-xs text-muted-foreground">{line}</p>
              ))}
            </div>
          )}

          {/* Filename */}
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded border border-border">
            <Download size={12} className="text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground font-mono truncate">{preview}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>
            {ja ? "キャンセル" : "Cancel"}
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={!hasData}
            className="gap-1.5"
          >
            <Download size={13} />
            {ja ? "書き出す" : "Export"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
