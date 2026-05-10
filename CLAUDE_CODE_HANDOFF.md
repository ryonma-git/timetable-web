# timetable-web — Claude Code 引き継ぎ書類

> 最終更新: 2026年5月（v79 One Tapログイン修正 / v78言語切替拡張）
> 対象: Claude Code（CLI）でこのリポジトリを引き継ぐ開発者

> **安定版の基準**: 暫定安定版は v74。v75以降は Claude Code / Codex 実装版だが、利用者確認前のため未検証扱いとする。ユーザーが明示しない限り、更新版を安定版とは記載しない。

---

## このファイルの使い方

Claude Code をプロジェクトフォルダで起動し、以下を最初に伝えるだけで引き継ぎ完了です。

```
CLAUDE_CODE_HANDOFF.md を読んで、このプロジェクトの概要と現状を把握してください
```

---

## プロジェクト概要

小学校教員向け週間時間割管理 Web アプリ。専科教員・担任どちらでも利用でき、授業変更（振替・入れ替え）を管理し、Excel/PDF でエクスポートできる。

| 項目 | 内容 |
|------|------|
| フレームワーク | React 19 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui |
| ルーティング | Wouter（`base={BASE}` 設定済み） |
| 状態管理 | React Context（TimetableContext） |
| パッケージマネージャー | pnpm |
| デプロイ | Manus（`https://timetableapp-ee4m7qag.manus.space`）+ GitHub Pages（`https://ryonma-git.github.io/timetable-web/`） |
| リポジトリ | `https://github.com/ryonma-git/timetable-web`（Public） |

---

## ★ 開発フロー（最重要）

**main ブランチに push するだけで GitHub Pages に自動デプロイされます。**

```bash
# 1. 最新を取り込む（Manus で作業があった場合）
git pull

# 2. 開発サーバー起動
pnpm install
pnpm run dev

# 3. 修正後の push（自動デプロイ）
git add -A
git commit -m "feat: ○○機能を追加"
git push
# → 2〜3分後に https://ryonma-git.github.io/timetable-web/ が更新される
```

デプロイ状況: https://github.com/ryonma-git/timetable-web/actions

今後の修正時は、実装変更とあわせて必要に応じて `README.md`、`HANDOVER.md`、`CLAUDE_CODE_HANDOFF.md` を更新し、`main` へ push する。GitHub Pages 公開は GitHub Actions の自動デプロイに任せる。push 後の報告では、ユーザーが確認しに行けるように公開ページ `https://ryonma-git.github.io/timetable-web/` を毎回貼る。

### 言語切替（v76〜v78 段階実装）

- `client/src/contexts/LanguageContext.tsx` で `ja` / `en` の辞書と `useLanguage()` を提供する。
- 日本語をデフォルトにし、`localStorage` の `timetable_language` に選択言語を保存する。
- 左下メニューに日本語/英語の切替を追加済み。
- v78時点ではサイドバー、上部操作ボタン、週間グリッド、自動復元、変更確認、学期タブ、統計・履歴・適用ログまで段階対応。設定系・新規作成ウィザード・インスペクター・エクスポート詳細・Google Drive/Calendar の細部は未移行が残る。

### Googleログイン修正（v79）

- One Tap の ID トークンからメールアドレスを取り出し、GIS の `login_hint` に渡すことでアカウント特定失敗を避ける。
- 既存ログインユーザーは `login_hint` 付きでサイレント取得、初回ユーザーはユーザー操作コンテキスト内で直接 `consent` に進める。
- v79 は Claude Code 実装の未検証更新。暫定安定版は引き続き v74。

### ⚠️ deploy.yml の変更について

`.github/workflows/deploy.yml` は **ローカル（Claude Code）からのみ push 可能**。  
Manus（クラウド）は GitHub App の権限制限でワークフローファイルを push できない。

---

## Manus との連携フロー

```
Claude Code（ローカル）
    ↕ git push / git pull
   GitHub（ryonma-git/timetable-web）
    ↕ checkpoint（自動 push/pull）
Manus（クラウド）→ Publish → timetableapp-ee4m7qag.manus.space
```

- **Claude Code で修正** → `git push` → GitHub Pages に自動デプロイ
- **Manus に反映したい場合** → Manus のチャットで「GitHub から最新を取り込んで Publish して」と依頼
- **Manus で修正後** → ローカルで `git pull` して取り込む
- **同じファイルを同時編集するとコンフリクト**が発生するため、作業は一方に集中させる

---

## ディレクトリ構成

```
timetable-web/
├── client/
│   ├── public/
│   │   └── 404.html               ← GitHub Pages SPA 用リダイレクト（v58追加）
│   └── src/
│       ├── App.tsx                 ← ルーター（Wouter、base={BASE}設定済み・v59）
│       ├── components/             ← UIコンポーネント（ダイアログ等）
│       ├── contexts/
│       │   ├── TimetableContext.tsx   ← ★ 最重要：全状態管理・時数計算
│       │   └── GradeColorContext.tsx  ← クラス色管理
│       ├── lib/
│       │   ├── timetableFile.ts       ← ★ 型定義・シリアライズ・generateBaseEntries
│       │   ├── timetable.ts           ← applyOverrides・calcClassStats
│       │   ├── exportUtils.ts         ← Excelエクスポート（ExcelJS）
│       │   └── timetablePdfExport.ts  ← PDFエクスポート（jsPDF直接描画）
│       └── pages/
│           └── Home.tsx               ← メインページ・ダイアログ管理
├── .github/workflows/deploy.yml       ← GitHub Pages自動デプロイ（ローカルからのみ変更可）
├── vite.config.ts                     ← base設定（VITE_BASE_URL環境変数で切り替え）
├── CLAUDE_CODE_HANDOFF.md             ← この書類
└── RESUME_CLAUDE_CODE.md              ← 作業再開手順（詳細版）
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

## GitHub Pages デプロイの仕組み（v58〜v59）

### SPA 404 対策（v58）

`client/public/404.html` が GitHub Pages の 404 をキャッチし、URL を sessionStorage に保存して `/timetable-web/` にリダイレクト。`client/index.html` でリダイレクト先 URL を復元してルーターに渡す。

### Wouter の base 設定（v59）

`App.tsx` で `import.meta.env.BASE_URL` を Wouter の `base` に設定。GitHub Pages デプロイ時（`BASE_URL=/timetable-web/`）でも `/` のルートが正しく解決される。

```typescript
// App.tsx
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '';

function Router() {
  return (
    <WouterRouter base={BASE}>
      <Switch>
        <Route path={"/"} component={Home} />
        ...
      </Switch>
    </WouterRouter>
  );
}
```

---

## 完了済みの主要実装（v54〜v59）

| バージョン | 内容 |
|-----------|------|
| v54 | Cmd/Ctrl 複数選択バグ修正・FSA 上書き保存（Chrome/Edge）・削除ダイアログスクロール対応 |
| v55 | NewFileWizard で `baseSchedules`・`weekCycleStart` が保存されないバグ修正・GitHub Pages 自動デプロイ設定 |
| v56 | 祝日コマの時数計算バグ修正（祝日マスク実装） |
| v57 | 引き継ぎ書類作成 |
| v58 | GitHub Pages SPA 404対策（`404.html` 追加・`index.html` リダイレクトスクリプト） |
| v59 | Wouter ルーターに `base={BASE}` 設定（GitHub Pages `/timetable-web/` パス対応）✅ 動作確認済み |

---

## 既知の未実装・改善候補

1. **Cmd+S / Ctrl+S ショートカット**: `keydown` イベントで上書き保存を実装
2. **印刷レイアウト**: `@media print` CSS で時間割を印刷対応
3. **複数クラスへの一括適用**: 同じ学年の複数クラスに同じ時間割をコピー
4. **振替授業の管理**: 祝日に振り替えた授業の追跡機能

---

## よくあるバグと対処法

| バグ | 原因 | 対処 |
|-----|------|------|
| 週選択が空 | `semester` が null | `effectiveEntries` から日付範囲を導出する |
| PDF文字が豆腐（□）になる | フォント未登録 | `timetablePdfExport.ts` の `loadFont()` が呼ばれているか確認 |
| 色が反映されない | `getClassColor` の引数不足 | `customClassColors` パラメータを渡す |
| TypeScriptエラー | `TimetableContextValue` に未定義メソッド | インターフェースとproviderの両方に追加 |
| B週データが空 | NewFileWizardのbaseSchedules設定漏れ | v55で修正済み |
| 祝日日が時数に含まれる | 祝日マスク未適用 | v56で修正済み |
| GitHub Pages で 404 | Wouter の base 未設定 | v59で修正済み |

---

## 開発コマンド

```bash
pnpm install              # 依存関係インストール
pnpm run dev              # 開発サーバー起動（http://localhost:5173）
npx tsc --noEmit          # TypeScript チェック
pnpm run build            # 本番ビルド（Manus環境用）
```

---

## 実装パターン集

### コンテキストに新しいアクションを追加する場合

1. `TimetableContextValue` インターフェースにメソッドを追加
2. `TimetableProvider` 内で `useCallback` で実装
3. `value` オブジェクトに追加

### OverrideOp を適用する場合

```typescript
const ops: OverrideOp[] = [
  { op: "set_period_class", date: "2026-05-01", period: 1, class: "3年1組" }
];
applyOps(ops, "授業追加");
```

### 祝日マスクを新しい集計関数に適用する場合

```typescript
const holidayDates = new Set(
  (semester?.holidays ?? []).map(h => typeof h === 'string' ? h : h.date)
);
const maskedEntries = holidayDates.size > 0
  ? entries.map(e => holidayDates.has(e.date)
      ? { ...e, periods: e.periods.map(p => ({ ...p, class: null, subject: null })) }
      : e)
  : entries;
```
