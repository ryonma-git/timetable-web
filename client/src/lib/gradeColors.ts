// gradeColors.ts
// Design: Swiss Grid × Japanese Functional Design
// Grade color system — 1〜6年 default palette + shared color swatches (any grade can pick any color)
// Subject color system — 教科ごとの色設定（homeroom/multi_subjectモード用）

export interface GradeColorDef {
  bg: string;       // background color for grid cells
  border: string;   // border color
  text: string;     // text color
  label: string;    // human-readable name
}

// ─────────────────────────────────────────────
// Shared color palette — all grades can pick any color, duplicates allowed
// ─────────────────────────────────────────────
export const COLOR_PALETTE: GradeColorDef[] = [
  { bg: "#fdf2f8", border: "#f0abcb", text: "#9d174d", label: "ピンク" },
  { bg: "#fff1f2", border: "#fda4af", text: "#be123c", label: "ローズ" },
  { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", label: "レッド" },
  { bg: "#fff7ed", border: "#fdba74", text: "#c2410c", label: "オレンジ" },
  { bg: "#fffbeb", border: "#fcd34d", text: "#b45309", label: "アンバー" },
  { bg: "#fefce8", border: "#fef08a", text: "#713f12", label: "イエロー" },
  { bg: "#f7fee7", border: "#bef264", text: "#3f6212", label: "ライムグリーン" },
  { bg: "#ecfdf5", border: "#6ee7b7", text: "#065f46", label: "エメラルド" },
  { bg: "#f0fdfa", border: "#5eead4", text: "#115e59", label: "ティール" },
  { bg: "#ecfeff", border: "#67e8f9", text: "#164e63", label: "シアン" },
  { bg: "#f0f9ff", border: "#7dd3fc", text: "#0c4a6e", label: "スカイブルー" },
  { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af", label: "ブルー" },
  { bg: "#eef2ff", border: "#a5b4fc", text: "#3730a3", label: "インディゴ" },
  { bg: "#f5f3ff", border: "#c4b5fd", text: "#5b21b6", label: "バイオレット" },
  { bg: "#faf5ff", border: "#d8b4fe", text: "#6b21a8", label: "パープル" },
  { bg: "#fdf4ff", border: "#f0abfc", text: "#701a75", label: "フューシャ" },
];

// ─────────────────────────────────────────────
// Default colors per grade
// 1年: ピンク, 2年: オレンジ, 3年: ライムグリーン
// 4年: エメラルド, 5年: ブルー, 6年: バイオレット
// ─────────────────────────────────────────────
export const DEFAULT_GRADE_COLORS: Record<string, GradeColorDef> = {
  "1": COLOR_PALETTE[0],   // ピンク
  "2": COLOR_PALETTE[3],   // オレンジ
  "3": COLOR_PALETTE[6],   // ライムグリーン
  "4": COLOR_PALETTE[7],   // エメラルド
  "5": COLOR_PALETTE[11],  // ブルー
  "6": COLOR_PALETTE[13],  // バイオレット
  "special": COLOR_PALETTE[4], // アンバー（特別授業など）
};

// ─────────────────────────────────────────────
// Default subject colors — 教科ごとのデフォルト色
// ─────────────────────────────────────────────
export const DEFAULT_SUBJECT_COLORS: Record<string, GradeColorDef> = {
  "国語":   { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", label: "国語" },
  "算数":   { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af", label: "算数" },
  "数学":   { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af", label: "数学" },
  "理科":   { bg: "#f0fdfa", border: "#5eead4", text: "#115e59", label: "理科" },
  "社会":   { bg: "#fff7ed", border: "#fdba74", text: "#c2410c", label: "社会" },
  "英語":   { bg: "#f0f9ff", border: "#7dd3fc", text: "#0c4a6e", label: "英語" },
  "体育":   { bg: "#ecfdf5", border: "#6ee7b7", text: "#065f46", label: "体育" },
  "音楽":   { bg: "#fdf2f8", border: "#f0abcb", text: "#9d174d", label: "音楽" },
  "図工":   { bg: "#fefce8", border: "#fef08a", text: "#713f12", label: "図工" },
  "美術":   { bg: "#fefce8", border: "#fef08a", text: "#713f12", label: "美術" },
  "家庭":   { bg: "#f7fee7", border: "#bef264", text: "#3f6212", label: "家庭" },
  "技術":   { bg: "#eef2ff", border: "#a5b4fc", text: "#3730a3", label: "技術" },
  "道徳":   { bg: "#fdf4ff", border: "#f0abfc", text: "#701a75", label: "道徳" },
  "総合":   { bg: "#faf5ff", border: "#d8b4fe", text: "#6b21a8", label: "総合" },
  "学活":   { bg: "#ecfeff", border: "#67e8f9", text: "#164e63", label: "学活" },
  "特活":   { bg: "#ecfeff", border: "#67e8f9", text: "#164e63", label: "特活" },
  "生活":   { bg: "#f7fee7", border: "#bef264", text: "#3f6212", label: "生活" },
  "外国語": { bg: "#f0f9ff", border: "#7dd3fc", text: "#0c4a6e", label: "外国語" },
  "情報":   { bg: "#eef2ff", border: "#a5b4fc", text: "#3730a3", label: "情報" },
  "保健":   { bg: "#ecfdf5", border: "#6ee7b7", text: "#065f46", label: "保健" },
};

export const SUBJECT_COLORS_STORAGE_KEY = "timetable_subject_colors_v1";

// ─────────────────────────────────────────────
// Extract grade key from class string
// e.g. "4年1組" → "4", "特別授業" → "special"
// ─────────────────────────────────────────────
export function getGradeKey(className: string | null): string {
  if (!className) return "special";
  const m = className.match(/^(\d)年/);
  if (m) return m[1];
  return "special";
}

// Get color for a class name
// カスタムクラスは "custom:className" キーで個別色を保存
export function getClassColor(
  className: string | null,
  gradeColors: Record<string, GradeColorDef>
): GradeColorDef {
  if (!className) return gradeColors["special"] ?? COLOR_PALETTE[4];
  // カスタムクラス個別色を優先
  const customKey = `custom:${className}`;
  if (gradeColors[customKey]) return gradeColors[customKey];
  // 学年キーで学年色
  const key = getGradeKey(className);
  return gradeColors[key] ?? gradeColors["special"] ?? COLOR_PALETTE[4];
}

/**
 * 教科名から色を取得する
 * 優先順位: subjectColors[subject] > DEFAULT_SUBJECT_COLORS[subject] > fallback gray
 */
export function getSubjectColor(
  subject: string | null,
  subjectColors: Record<string, GradeColorDef>
): GradeColorDef {
  if (!subject) return { bg: "#f3f4f6", border: "#d1d5db", text: "#6b7280", label: "" };
  // カスタム設定を優先
  if (subjectColors[subject]) return subjectColors[subject];
  // デフォルト設定
  if (DEFAULT_SUBJECT_COLORS[subject]) return DEFAULT_SUBJECT_COLORS[subject];
  // フォールバック: パレットから循環して割り当て
  const idx = Math.abs(hashString(subject)) % COLOR_PALETTE.length;
  return { ...COLOR_PALETTE[idx], label: subject };
}

/** 文字列の簡易ハッシュ（色の循環割り当て用） */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

// ─────────────────────────────────────────────
// localStorage persistence
// ─────────────────────────────────────────────
export const GRADE_COLORS_STORAGE_KEY = "timetable_grade_colors_v3";

export function loadGradeColorsFromStorage(): Record<string, GradeColorDef> {
  try {
    const raw = localStorage.getItem(GRADE_COLORS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GRADE_COLORS };
    const parsed = JSON.parse(raw);
    const result: Record<string, GradeColorDef> = { ...DEFAULT_GRADE_COLORS };
    // 学年色と「special」を読み込む
    for (const grade of ["1", "2", "3", "4", "5", "6", "special"]) {
      if (parsed[grade]?.bg && parsed[grade]?.border) {
        result[grade] = parsed[grade];
      }
    }
    // 「custom:xxx」キーの個別色も読み込む
    for (const key of Object.keys(parsed)) {
      if (key.startsWith('custom:') && parsed[key]?.bg && parsed[key]?.border) {
        result[key] = parsed[key];
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_GRADE_COLORS };
  }
}

export function saveGradeColorsToStorage(colors: Record<string, GradeColorDef>): void {
  try {
    localStorage.setItem(GRADE_COLORS_STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // ignore
  }
}

export function loadSubjectColorsFromStorage(): Record<string, GradeColorDef> {
  try {
    const raw = localStorage.getItem(SUBJECT_COLORS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const result: Record<string, GradeColorDef> = {};
    for (const key of Object.keys(parsed)) {
      if (parsed[key]?.bg && parsed[key]?.border) {
        result[key] = parsed[key];
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveSubjectColorsToStorage(colors: Record<string, GradeColorDef>): void {
  try {
    localStorage.setItem(SUBJECT_COLORS_STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // ignore
  }
}
