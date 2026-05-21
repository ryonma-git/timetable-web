// ColorSettingsDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// All grades share the same COLOR_PALETTE; duplicates are allowed.
// Custom (non-grade) classes can have individual colors via "custom:className" keys.

import { useState } from "react";
import { Palette, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  COLOR_PALETTE,
  DEFAULT_GRADE_COLORS,
  GradeColorDef,
  saveGradeColorsToStorage,
} from "@/lib/gradeColors";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { useTimetable } from "@/contexts/TimetableContext";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/contexts/LanguageContext";

function wfcs(t: (k: TranslationKey) => string, key: TranslationKey, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// カスタムクラス（「n年m組」形式でないもの）を判定
function isCustomClass(className: string): boolean {
  return !/^\d+年\d+組$/.test(className);
}

export function ColorSettingsDialog() {
  const { gradeColors, setGradeColors } = useGradeColors();
  const { classList } = useTimetable();
  const { t } = useLanguage();

  const GRADE_LABELS: Record<string, string> = {
    "1": t("colorSettings.grade1"),
    "2": t("colorSettings.grade2"),
    "3": t("colorSettings.grade3"),
    "4": t("colorSettings.grade4"),
    "5": t("colorSettings.grade5"),
    "6": t("colorSettings.grade6"),
    "special": t("colorSettings.gradeSpecial"),
  };
  const [open, setOpen] = useState(false);
  const [localColors, setLocalColors] = useState<Record<string, GradeColorDef>>({ ...gradeColors });
  const [showCustomSection, setShowCustomSection] = useState(true);

  // カスタムクラスリスト（「n年m組」形式でないもの）
  const customClasses = classList.filter(isCustomClass);

  const handleOpen = () => {
    setLocalColors({ ...gradeColors });
    setOpen(true);
  };

  const handleClose = (isOpen: boolean) => {
    setOpen(isOpen);
  };

  const handleSelect = (key: string, color: GradeColorDef) => {
    setLocalColors((prev) => ({ ...prev, [key]: color }));
  };

  const handleApply = () => {
    setGradeColors(localColors);
    saveGradeColorsToStorage(localColors);
    setOpen(false);
  };

  const handleReset = () => {
    // 学年色のみリセット（カスタムクラス個別色は保持）
    const resetColors = { ...localColors };
    for (const grade of Object.keys(DEFAULT_GRADE_COLORS)) {
      resetColors[grade] = DEFAULT_GRADE_COLORS[grade];
    }
    setLocalColors(resetColors);
  };

  const handleResetCustom = (className: string) => {
    const key = `custom:${className}`;
    setLocalColors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const renderColorRow = (key: string, label: string, fallbackKey?: string) => {
    const fallback = fallbackKey ? (localColors[fallbackKey] ?? DEFAULT_GRADE_COLORS["special"]) : DEFAULT_GRADE_COLORS["special"];
    const current = localColors[key] ?? fallback;
    const hasCustom = !!localColors[key];

    return (
      <div key={key} className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border"
            style={{
              backgroundColor: current.bg,
              borderColor: current.border,
              color: current.text,
            }}
          >
            {label}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("colorSettings.currentLabel")} {current.label}
            {!hasCustom && fallbackKey && <span className="ml-1 text-muted-foreground/60">{t("colorSettings.defaultColor")}</span>}
          </span>
          {hasCustom && fallbackKey && (
            <button
              type="button"
              onClick={() => handleResetCustom(label)}
              className="text-[10px] text-muted-foreground hover:text-foreground underline"
            >
              {t("colorSettings.resetBtn")}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {COLOR_PALETTE.map((color, i) => {
            const isSelected =
              current.bg === color.bg && current.border === color.border;
            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleSelect(key, color)}
                    className={`relative w-8 h-8 rounded-full border-2 transition-all duration-100 focus:outline-none
                      ${isSelected
                        ? "ring-2 ring-offset-1 scale-110"
                        : "hover:scale-110"
                      }`}
                    style={{
                      backgroundColor: color.bg,
                      borderColor: isSelected ? color.text : color.border,
                      // @ts-ignore
                      "--tw-ring-color": color.text,
                    }}
                    aria-label={color.label}
                  >
                    <span
                      className="absolute inset-1.5 rounded-full"
                      style={{ backgroundColor: color.border }}
                    />
                    {isSelected && (
                      <span className="absolute inset-0 flex items-center justify-center z-10">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2 6L5 9L10 3"
                            stroke={color.text}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{color.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
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
            <span>{t("colorSettings.sidebarLabel")}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("colorSettings.sidebarTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palette size={18} />
              {t("colorSettings.title")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <p className="text-xs text-muted-foreground">
              {t("colorSettings.desc")}
            </p>

            {/* Grade color section */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("colorSettings.gradeSectionTitle")}</p>
              <div className="space-y-5">
                {Object.entries(GRADE_LABELS).map(([grade, label]) =>
                  renderColorRow(grade, label)
                )}
              </div>
            </div>

            {/* Custom class colors section */}
            {customClasses.length > 0 && (
              <div className="border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowCustomSection(v => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 hover:text-foreground transition-colors"
                >
                  {showCustomSection ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {t("colorSettings.customSectionTitle")}
                  <span className="font-normal text-muted-foreground/60">（{wfcs(t, "colorSettings.customCount", { n: customClasses.length })}）</span>
                </button>
                {showCustomSection && (
                  <div className="space-y-5">
                    <p className="text-xs text-muted-foreground -mt-1">
                      {t("colorSettings.customSectionNote")}
                    </p>
                    {customClasses.map(cls =>
                      renderColorRow(`custom:${cls}`, cls, "special")
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="border rounded-md p-3 bg-muted/30 mt-2">
            <p className="text-xs text-muted-foreground mb-2">{t("colorSettings.previewLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(GRADE_LABELS).map(([grade, label]) => {
                const c = localColors[grade] ?? DEFAULT_GRADE_COLORS[grade];
                return (
                  <div
                    key={grade}
                    className="px-2 py-1 rounded text-xs font-medium border"
                    style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
                  >
                    {label}
                  </div>
                );
              })}
              {customClasses.map(cls => {
                const key = `custom:${cls}`;
                const c = localColors[key] ?? localColors["special"] ?? DEFAULT_GRADE_COLORS["special"];
                return (
                  <div
                    key={cls}
                    className="px-2 py-1 rounded text-xs font-medium border"
                    style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
                  >
                    {cls}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5">
              <RotateCcw size={13} />
              {t("colorSettings.resetGradeBtn")}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                {t("colorSettings.cancelBtn")}
              </Button>
              <Button size="sm" onClick={handleApply}>
                {t("colorSettings.applyBtn")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
