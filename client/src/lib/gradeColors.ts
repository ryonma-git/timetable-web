// gradeColors.ts
// Design: Swiss Grid × Japanese Functional Design
// Grade color system: 1-6 grades with swatchable palettes

export interface GradeColorDef {
  bg: string;
  border: string;
  text: string;
  label: string;
}

export interface GradeColorPalette {
  id: string;
  name: string;
  colors: Record<string, GradeColorDef>; // key: "1"~"6" + "special"
}

// Default color palette (デフォルト: 虹順)
export const DEFAULT_GRADE_COLORS: Record<string, GradeColorDef> = {
  "1": { bg: "#fff0f6", border: "#ffb3c6", text: "#9d174d", label: "1年" },   // ピンク
  "2": { bg: "#fff7ed", border: "#fed7aa", text: "#9a3412", label: "2年" },   // オレンジ
  "3": { bg: "#fefce8", border: "#fde047", text: "#713f12", label: "3年" },   // 黄緑→黄色系
  "4": { bg: "#f0fdf4", border: "#86efac", text: "#14532d", label: "4年" },   // 緑
  "5": { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", label: "5年" },   // 青
  "6": { bg: "#f5f3ff", border: "#ddd6fe", text: "#4c1d95", label: "6年" },   // 紫
  "special": { bg: "#fffbeb", border: "#fde68a", text: "#92400e", label: "特別" }, // アンバー
};

// Swatch options per grade (same tone, different hue)
export const GRADE_COLOR_SWATCHES: Record<string, GradeColorDef[]> = {
  "1": [
    { bg: "#fff0f6", border: "#ffb3c6", text: "#9d174d", label: "ピンク（デフォルト）" },
    { bg: "#fdf2f8", border: "#f0abfc", text: "#701a75", label: "マゼンタ" },
    { bg: "#fff1f2", border: "#fecdd3", text: "#9f1239", label: "ローズ" },
    { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", label: "レッド" },
  ],
  "2": [
    { bg: "#fff7ed", border: "#fed7aa", text: "#9a3412", label: "オレンジ（デフォルト）" },
    { bg: "#fff8f1", border: "#fdba74", text: "#c2410c", label: "ディープオレンジ" },
    { bg: "#fffbeb", border: "#fde68a", text: "#92400e", label: "アンバー" },
    { bg: "#fefce8", border: "#fef08a", text: "#713f12", label: "イエロー" },
  ],
  "3": [
    { bg: "#f7fee7", border: "#bef264", text: "#3f6212", label: "黄緑（デフォルト）" },
    { bg: "#fefce8", border: "#fde047", text: "#713f12", label: "イエロー" },
    { bg: "#f0fdf4", border: "#86efac", text: "#14532d", label: "ライトグリーン" },
    { bg: "#ecfdf5", border: "#6ee7b7", text: "#065f46", label: "ミント" },
  ],
  "4": [
    { bg: "#f0fdf4", border: "#86efac", text: "#14532d", label: "グリーン（デフォルト）" },
    { bg: "#ecfdf5", border: "#6ee7b7", text: "#065f46", label: "エメラルド" },
    { bg: "#f0fdfa", border: "#99f6e4", text: "#134e4a", label: "ティール" },
    { bg: "#ecfeff", border: "#a5f3fc", text: "#164e63", label: "シアン" },
  ],
  "5": [
    { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", label: "ブルー（デフォルト）" },
    { bg: "#f0f9ff", border: "#bae6fd", text: "#0c4a6e", label: "スカイブルー" },
    { bg: "#eef2ff", border: "#c7d2fe", text: "#3730a3", label: "インディゴ" },
    { bg: "#f0fdfa", border: "#99f6e4", text: "#134e4a", label: "ティール" },
  ],
  "6": [
    { bg: "#f5f3ff", border: "#ddd6fe", text: "#4c1d95", label: "パープル（デフォルト）" },
    { bg: "#fdf4ff", border: "#f0abfc", text: "#701a75", label: "フューシャ" },
    { bg: "#faf5ff", border: "#e9d5ff", text: "#581c87", label: "バイオレット" },
    { bg: "#fdf2f8", border: "#f0abfc", text: "#9d174d", label: "プラム" },
  ],
};

// Extract grade number from class name (e.g. "4年2組" → "4")
export function getGradeKey(className: string | null): string {
  if (!className) return "special";
  const m = className.match(/^(\d)年/);
  if (m) return m[1];
  return "special";
}

// Get color for a class name
export function getClassColor(
  className: string | null,
  gradeColors: Record<string, GradeColorDef>
): GradeColorDef {
  const key = getGradeKey(className);
  return gradeColors[key] ?? gradeColors["special"];
}

// Storage key
export const GRADE_COLORS_STORAGE_KEY = "timetable_grade_colors";

export function loadGradeColorsFromStorage(): Record<string, GradeColorDef> {
  try {
    const raw = localStorage.getItem(GRADE_COLORS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle new grades
      return { ...DEFAULT_GRADE_COLORS, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_GRADE_COLORS };
}

export function saveGradeColorsToStorage(colors: Record<string, GradeColorDef>): void {
  localStorage.setItem(GRADE_COLORS_STORAGE_KEY, JSON.stringify(colors));
}
