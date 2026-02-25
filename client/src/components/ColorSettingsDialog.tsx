// ColorSettingsDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// Grade color swatch picker dialog

import { useState } from "react";
import { Palette, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DEFAULT_GRADE_COLORS,
  GRADE_COLOR_SWATCHES,
  GradeColorDef,
  saveGradeColorsToStorage,
} from "@/lib/gradeColors";
import { useGradeColors } from "@/contexts/GradeColorContext";

const GRADE_LABELS: Record<string, string> = {
  "1": "1年", "2": "2年", "3": "3年",
  "4": "4年", "5": "5年", "6": "6年",
};

export function ColorSettingsDialog() {
  const { gradeColors, setGradeColors } = useGradeColors();
  const [open, setOpen] = useState(false);
  const [localColors, setLocalColors] = useState<Record<string, GradeColorDef>>({ ...gradeColors });

  const handleOpen = () => {
    setLocalColors({ ...gradeColors });
    setOpen(true);
  };

  const handleClose = (isOpen: boolean) => {
    setOpen(isOpen);
  };

  const handleSelect = (grade: string, swatch: GradeColorDef) => {
    setLocalColors(prev => ({ ...prev, [grade]: swatch }));
  };

  const handleApply = () => {
    setGradeColors(localColors);
    saveGradeColorsToStorage(localColors);
    setOpen(false);
  };

  const handleReset = () => {
    setLocalColors({ ...DEFAULT_GRADE_COLORS });
  };

  return (
    <>
      {/* Trigger button — standalone, no DialogTrigger wrapper */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleOpen}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md
                       text-sidebar-foreground/70 hover:text-sidebar-foreground
                       hover:bg-sidebar-accent text-xs transition-colors duration-100"
          >
            <Palette size={14} />
            <span>学年カラー設定</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">学年ごとの表示色を変更</TooltipContent>
      </Tooltip>

      {/* Dialog — controlled externally */}
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palette size={18} />
              学年カラー設定
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              各学年の表示色を選択してください。選択した色はこのブラウザに保存されます。
            </p>

            {Object.entries(GRADE_LABELS).map(([grade, label]) => {
              const swatches = GRADE_COLOR_SWATCHES[grade] ?? [];
              const current = localColors[grade];

              return (
                <div key={grade} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: current.bg, borderColor: current.border }}
                    />
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">{current.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {swatches.map((swatch, i) => {
                      const isSelected = current.bg === swatch.bg && current.border === swatch.border;
                      return (
                        <Tooltip key={i}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => handleSelect(grade, swatch)}
                              className={`w-8 h-8 rounded-md border-2 transition-all duration-100
                                ${isSelected
                                  ? "border-primary ring-2 ring-primary/30 scale-110"
                                  : "border-transparent hover:border-muted-foreground/40 hover:scale-105"
                                }`}
                              style={{ backgroundColor: swatch.bg, borderColor: isSelected ? undefined : swatch.border }}
                              aria-label={swatch.label}
                            />
                          </TooltipTrigger>
                          <TooltipContent>{swatch.label}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Preview */}
          <div className="border rounded-md p-3 bg-muted/30">
            <p className="text-xs text-muted-foreground mb-2">プレビュー</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(GRADE_LABELS).map(([grade, label]) => {
                const c = localColors[grade];
                return (
                  <div
                    key={grade}
                    className="px-2 py-1 rounded text-xs font-medium border"
                    style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
                  >
                    {label}サンプル
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5">
              <RotateCcw size={13} />
              デフォルトに戻す
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                キャンセル
              </Button>
              <Button size="sm" onClick={handleApply}>
                適用
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
