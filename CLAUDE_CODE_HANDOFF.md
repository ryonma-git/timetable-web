# timetable-web — Claude Code 引き継ぎ書類

> 最終更新: 2026年5月（v56）  
> 対象: Claude Code（CLI）でこのリポジトリを引き継ぐ開発者

---

## プロジェクト概要

小学校教員向け週間時間割管理 Web アプリ。体育専科教員が授業変更（振替・入れ替え）を管理し、Excel/PDF でエクスポートできる。

| 項目 | 内容 |
|------|------|
| フレームワーク | React 19 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui |
| ルーティング | Wouter |
| 状態管理 | React Context（TimetableContext） |
| パッケージマネージャー | pnpm |
| デプロイ | Manus（`https://timetableapp-ee4m7qag.manus.space`）+ GitHub Pages（`https://ryonma-git.github.io/timetable-web/`） |
| リポジトリ | `https://github.com/ryonma-git/timetable-web`（Public） |

---

## ディレクトリ構成

```
timetable-web/
├── client/
│   ├── public/
│   └── src/
│       ├── components/        ← UIコンポーネント（ダイアログ等）
│       ├── contexts/
│       │   ├── TimetableContext.tsx   ← ★ 最重要：全状態管理
│       │   └── GradeColorContext.tsx  ← クラス色管理
│       ├── lib/
│       │   ├── timetableFile.ts       ← ★ 型定義・シリアライズ・generateBaseEntries
│       │   ├── timetable.ts           ← applyOverrides・ユーティリティ・calcClassStats
│       │   ├── exportUtils.ts         ← Excelエクスポート（ExcelJS）
│       │   └── timetablePdfExport.ts  ← PDFエクスポート（jsPDF直接描画）
│       └── pages/
│           └── Home.tsx               ← メインページ・ダイアログ管理
├── .github/workflows/deploy.yml       ← GitHub Pages自動デプロイ（mainブランチpush時）
├── vite.config.ts                     ← base設定（VITE_BASE_URL環境変数で切り替え）
├── CLAUDE_CODE_HANDOFF.md             ← この書類
└── skills/timetable-app/SKILL.md      ← Manus用スキル（詳細設計ドキュメント）
```

---

## コアデータモデル

### TimetableFile（`.timetable` ファイルのルート型）

```typescript
interface TimetableFile {
  format: "timetable-app/v1";
  meta: {
    title: string;
    school?: string;
    year?: string;
    mode: TimetableMode;   // 'single_subject' | 'multi_subject' | 'homeroom'
    createdAt: string;
    updatedAt: string;
  };
  subjects: SubjectDef[];
  // v2: 複数学期（こちらが主）
  semesters?: SemesterData[];
  activeSemesterIndex?: number;
  // v1 レガシー（単一学期）
  semester?: SemesterMeta;
  base?: TimetableEntry[];
  ops?: OverrideOp[];
}
```

### SemesterMeta（学期設定）

```typescript
interface SemesterMeta {
  semesterNumber: 1 | 2 | 3;
  semesterSystem: "trimester" | "semester";
  startDate: string;   // YYYY-MM-DD
  endDate: string;
  hasSaturday: boolean;
  hasSunday: boolean;
  // 単週の場合
  baseSchedule?: Record<string, Record<number, string | null>>;
  subjectSchedule?: Record<string, Record<number, string | null>>;
  // 複週（A週/B週等）の場合
  baseSchedules?: Array<{
    label: string;
    schedule: Record<string, Record<number, string | null>>;
    subjectSchedule?: Record<string, Record<number, string | null>>;
  }>;
  weekCycleStart?: string;   // A週開始の月曜日（YYYY-MM-DD）
  schoolType?: SchoolType;
  gradeClassCounts?: number[];
  classList?: string[];
  customClasses?: string[];
  homeroomClass?: string;
  holidays?: HolidayEntry[];        // ← 祝日・休校日リスト（時数計算に影響）
  periodTimes?: PeriodTimesMap;
  periodTimesByDay?: Record<string, PeriodTimesMap>;
  weekPatternOverrides?: Record<string, number>;
}
```

### OverrideOp（変更操作）

```typescript
interface OverrideOp {
  op: "set_period_class" | "clear_period_class" | "set_period_reason" | "set_day_reason";
  date: string;
  period?: number;
  class?: string | null;
  reason?: string;
  target_class?: string | null;
  replace?: boolean;
  clear_all_classes?: boolean;
}
```

**演算モデル**: `base[]` + `ops[]` → `effective[]`（`applyOverrides` 関数で計算）

---

## TimetableContext の主要 API

```typescript
const {
  currentFile,          // TimetableFile | null
  semester,             // 現在アクティブな SemesterMeta
  activeSemesterIndex,  // 現在の学期インデックス
  effectiveEntries,     // 計算済みエントリ（表示用）
  baseEntries,          // ベースエントリ
  allOps,               // 全変更操作
  isDirty,              // 未保存フラグ
  isLoaded,             // ファイル読み込み済みフラグ
  mode,                 // TimetableMode
  subjects,             // SubjectDef[]
  classList,            // string[]
  holidays,             // HolidayEntry[]
  fileHandle,           // FileSystemFileHandle | null（FSA対応ブラウザ）
  hasFileSystemAccess,  // boolean

  // アクション
  loadTimetableFile,    // (file: TimetableFile) => Promise<void>
  loadFromNativeFile,   // (file: File) => Promise<{ warnings: string[] }>
  saveFile,             // () => Promise<void>（FSAあり→上書き、なし→ダウンロード）
  saveFileAs,           // (filename?: string) => void
  applyOps,             // (ops: OverrideOp[], description: string) => AuditEntry[]
  updateSettings,       // (newSemester: SemesterMeta, applyFrom?: string, newMode?: TimetableMode) => void
  updateHolidays,       // (holidays: HolidayEntry[]) => void
  switchToSemester,     // (idx: number) => void
  addSemester,          // (data: SemesterData) => void
  removeSemester,       // (idx: number) => void
  undo, redo,           // () => void
} = useTimetable();
```

---

## 動作モード

| モード | 説明 | 特徴 |
|--------|------|------|
| `single_subject` | 単一教科（体育専科等） | クラス欄に「n年m組」を入力 |
| `multi_subject` | 複数教科 | subjects 配列で教科定義、クラス欄に教科名 |
| `homeroom` | 担任（学級担任） | homeroomClass で自クラスを設定、他クラスの授業も管理 |

---

## 複週（A週/B週）ローテーション

`semester.baseSchedules` が設定されている場合、`generateBaseEntries` が `weekCycleStart` を基準に週ごとに A週/B週 を自動割り当てる。

- `weekCycleStart`: A週開始の月曜日（YYYY-MM-DD）
- `baseSchedules[0]` = A週、`baseSchedules[1]` = B週（最大4週まで）
- 週の判定: `Math.floor(weeksDiff) % baseSchedules.length`

**注意（v55修正済み）**: NewFileWizard で `semester.baseSchedules` と `semester.weekCycleStart` を必ず設定すること。設定漏れがあると「学期設定を変更」ダイアログでB週データが空になる。

---

## 祝日マスクによる時数計算（v56実装）

`semester.holidays` に登録された日付のコマは、時数集計から自動的に除外される。

**実装箇所**:
- `TimetableContext.tsx`（学期別集計）: `classStats` / `subjectStats` の計算前に祝日日のコマを `class=null` にした `statsEntries` を生成
- `StatsView.tsx`（年間集計）: `AnnualStatsView` の `annualStats` 計算でも同様の祝日マスクを適用

```typescript
// 祝日マスクのパターン（TimetableContext・StatsView共通）
const holidayDates = new Set(
  (semester.holidays ?? []).map(h => typeof h === 'string' ? h : h.date)
);
const statsEntries = holidayDates.size > 0
  ? effectiveEntries.map(entry =>
      holidayDates.has(entry.date)
        ? { ...entry, periods: entry.periods.map(p => ({ ...p, class: null, subject: null })) }
        : entry
    )
  : effectiveEntries;
```

**注意**: `effectiveEntries`（WeekGrid の表示用）は変更しない。祝日のグレーアウト表示は既存の仕組みで対応。

---

## File System Access API（上書き保存）

- Chrome/Edge 対応、Safari は非対応（フォールバックでダウンロード）
- `handleOpenWithFSA`（Sidebar.tsx）でファイルを開く → `FileSystemFileHandle` を取得
- `window.dispatchEvent(new CustomEvent('timetable:setFileHandle', { detail: handle }))` で Context に渡す
- `saveFile` で `fileHandle` があれば `createWritable()` で上書き保存

---

## GitHub Pages デプロイ

`.github/workflows/deploy.yml` で自動デプロイ設定済み。

```yaml
# mainブランチにpushすると自動デプロイ
# ビルド時に VITE_BASE_URL=/timetable-web/ を設定
```

**設定手順**（リポジトリ管理者が一度だけ実施）:

1. GitHub リポジトリ → Settings → Pages
2. Source: **GitHub Actions** を選択
3. main ブランチに push すると自動デプロイ開始

---

## 主要コンポーネント一覧

| ファイル | 役割 |
|---------|------|
| `Home.tsx` | メインページ。ダイアログの open 状態管理 |
| `Sidebar.tsx` | サイドバー。ファイル操作・保存ボタン |
| `WeekGrid.tsx` | 週間グリッド表示。複数選択（Excel方式）対応 |
| `Inspector.tsx` | セル詳細・編集パネル。複数選択時の一括操作 |
| `NewFileWizard.tsx` | 新規作成ウィザード（5ステップ）|
| `SettingsDialog.tsx` | 学期設定変更ダイアログ（5ステップ）|
| `PeriodTimesDialog.tsx` | 時程設定。逆算補助パネル（CalcHelperPanel）内蔵 |
| `ConfirmChangeDialog.tsx` | 変更確認ダイアログ。スクロール対応 |
| `ExportDialog.tsx` | Excel/PDF エクスポート |
| `PrintPreviewDialog.tsx` | 印刷プレビュー |
| `StatsView.tsx` | クラス別集計・年間集計（祝日マスク適用済み） |
| `PatchImportDialog.tsx` | パッチインポート |
| `HolidaySettingsDialog.tsx` | 祝日・休校日管理 |
| `SemesterTabs.tsx` | 学期タブ切り替え |
| `CalcHelperPanel.tsx` | 時程逆算補助パネル |

---

## 既知の問題・修正履歴

| バージョン | 修正内容 |
|-----------|---------|
| v56 | 祝日コマの時数計算バグ修正（祝日マスク実装） |
| v55 | B週データ読み込みバグ修正（NewFileWizardのbaseSchedules・weekCycleStart設定漏れ） |
| v55 | _setLoadedStateでactiveSemesterIndexをリセット |
| v55 | GitHub Pages自動デプロイ設定（.github/workflows/deploy.yml） |
| v54 | Cmd/Ctrl複数選択バグ修正 |
| v54 | File System Access API（上書き保存）実装 |

---

## よくあるバグと対処法

| バグ | 原因 | 対処 |
|-----|------|------|
| 週選択が空 | `semester` が null | `effectiveEntries` から日付範囲を導出する |
| PDF文字が豆腐（□）になる | フォント未登録 | `timetablePdfExport.ts` の `loadFont()` が呼ばれているか確認 |
| PDF固まる | html2canvasやSVG→Canvas変換 | jsPDF直接描画方式を使用（html2canvas禁止） |
| 色が反映されない | `getClassColor` の引数不足 | `customClassColors` パラメータを渡す |
| TypeScriptエラー | `TimetableContextValue` に未定義メソッド | インターフェースとproviderの両方に追加 |
| HMRが更新されない | Viteキャッシュ | 開発サーバーを再起動 |
| B週データが空 | NewFileWizardのbaseSchedules設定漏れ | v55で修正済み |
| 祝日日が時数に含まれる | 祝日マスク未適用 | v56で修正済み |

---

## 開発コマンド

```bash
# 依存関係インストール
pnpm install

# 開発サーバー起動
pnpm run dev

# TypeScript チェック
npx tsc --noEmit

# ビルド（Manus環境用）
pnpm run build

# ビルド（GitHub Pages用）
VITE_BASE_URL=/timetable-web/ pnpm run build
```

---

## 実装パターン集

### コンテキストに新しいアクションを追加する場合

1. `TimetableContextValue` インターフェースにメソッドを追加
2. `TimetableProvider` 内で `useCallback` で実装
3. `value` オブジェクトに追加

### 新しいダイアログを追加する場合

1. `client/src/components/` に新コンポーネントを作成
2. `Home.tsx` で `useState` で open 状態を管理
3. `Home.tsx` の右上ボタンエリアまたはドロップダウンに追加

### OverrideOp を適用する場合

```typescript
const ops: OverrideOp[] = [
  { op: "set_period_class", date: "2026-05-01", period: 1, class: "3年1組" }
];
applyOps(ops, "授業追加");
```

### 祝日マスクを新しい集計関数に適用する場合

```typescript
// semester.holidays を Set に変換してマスク適用
const holidayDates = new Set(
  (semester?.holidays ?? []).map(h => typeof h === 'string' ? h : h.date)
);
const maskedEntries = holidayDates.size > 0
  ? entries.map(e => holidayDates.has(e.date)
      ? { ...e, periods: e.periods.map(p => ({ ...p, class: null, subject: null })) }
      : e)
  : entries;
```

---

## 参照ファイル

- `skills/timetable-app/SKILL.md`: Manus 用スキル（詳細設計ドキュメント）
- `references/patch_format.md`: パッチインポート形式の詳細仕様
- `references/data_model.md`: 全型定義の詳細
- `client/src/lib/timetableFile.ts`: 型定義・シリアライズ・`generateBaseEntries`
- `client/src/lib/timetable.ts`: `applyOverrides` / `calcClassStats` 実装
