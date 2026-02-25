# 時間割管理アプリ — README

体育教師向けの週間時間割管理Webアプリケーションです。React + TypeScript + Tailwind CSS で構築されており、ブラウザ上で完結するフロントエンドオンリーの構成です。

---

## 主な機能

| 機能カテゴリ | 詳細 |
|------------|------|
| **時間割グリッド** | 週間ビューで各日・各時限のクラスを表示・編集。今日の列をハイライト表示 |
| **クラス割り当て** | セルをクリックしてクラスを選択。備考（reason）の入力も可能 |
| **複数学期管理** | 1学期〜3学期（または前期・後期）を切り替えて管理 |
| **基本時間割** | 曜日ごとのデフォルトクラスを設定し、学期開始時に自動適用 |
| **祝日・休校日管理** | 祝日・休校日を設定すると、CSVや印刷時に「祝日」名が自動付加 |
| **特別クラス** | 個別に色設定可能なカスタムクラスを追加・削除 |
| **クラス別集計** | 学期ごと・年間の授業コマ数・残り時数・進捗率を表示 |
| **変更履歴・監査ログ** | 全ての変更操作を記録し、Undo/Redo で取り消し・やり直しが可能 |
| **印刷プレビュー** | 週・月・学期・今週から先n週など複数の印刷範囲を選択可能 |
| **Excelエクスポート** | 時間割をExcel形式でダウンロード（備考列・祝日色付き対応） |
| **CSVエクスポート** | 年間集計・時間割データをCSV形式でダウンロード |
| **パッチインポート** | `timetable-patch/v1` 形式のJSONで時間割を部分的・全体的に書き換え |
| **自動保存** | 変更からlocalStorageに自動保存し、次回起動時に復元確認 |

---

## ファイル形式

### `.timetable` ファイル（ネイティブ形式）

アプリの保存形式は `.timetable` 拡張子のJSONファイルです。

```json
{
  "format": "timetable-app/v1",
  "version": "1.0",
  "meta": {
    "title": "2024年度 体育時間割",
    "school": "○○小学校",
    "year": "2024",
    "createdAt": "2024-04-01T00:00:00.000Z",
    "updatedAt": "2024-09-01T00:00:00.000Z"
  },
  "semesters": [ ... ],
  "activeSemesterIndex": 0
}
```

### `timetable-patch/v1` ファイル（パッチインポート形式）

特定の期間だけ時間割を書き換えるためのJSONファイル形式です。詳細は `README_import.md` を参照してください。

---

## 画面構成

```
┌─────────────────────────────────────────────────────────────┐
│  ヘッダー: タイトル / 保存 / インポート / 書き出し / 印刷     │
├──────────┬──────────────────────────────────┬───────────────┤
│          │  SemesterTabs（学期切り替え）      │               │
│ Sidebar  │  WeekGrid（週間時間割グリッド）    │  Inspector    │
│          │  または                           │  （セル詳細） │
│ ・ファイル│  StatsView（クラス別集計）         │               │
│ ・設定   │  HistoryView（変更履歴）           │               │
│ ・祝日   │  AuditView（監査ログ）             │               │
└──────────┴──────────────────────────────────┴───────────────┘
```

---

## データモデル

### `TimetableEntry`（1日分のエントリ）

```typescript
{
  date: string;        // "YYYY-MM-DD"
  weekday: string;     // "Mon", "Tue", ...
  weekday_jp: string;  // "月", "火", ...
  periods: PeriodSlot[];
}
```

### `PeriodSlot`（1コマ分のデータ）

```typescript
{
  period: number;        // 1〜6
  class: string | null;  // クラス名、null = 空きコマ
  reason?: string;       // 備考
}
```

### `OverrideOp`（変更操作）

変更はすべて `OverrideOp` の配列として記録されます。ベース時間割に操作を重ねることで実際の時間割（effective）を生成します。

| `op` 値 | 動作 |
|---------|------|
| `set_period_class` | 特定コマにクラスを割り当てる |
| `clear_period_class` | 特定コマを空きコマにする |
| `set_period_reason` | 特定コマに備考を設定する |
| `set_day_reason` | 特定日に日付レベルの備考を設定する |

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| フレームワーク | React 19 + TypeScript |
| スタイリング | Tailwind CSS 4 + shadcn/ui |
| ルーティング | Wouter |
| ファイル操作 | JSZip（ZIPレガシーインポート） |
| Excelエクスポート | ExcelJS |
| 状態管理 | React Context（TimetableContext） |
| ビルドツール | Vite |

---

## ディレクトリ構成

```
client/src/
  components/
    WeekGrid.tsx          # 週間グリッド表示
    Inspector.tsx         # セル詳細・編集パネル
    Sidebar.tsx           # サイドバー（ファイル操作・設定）
    StatsView.tsx         # クラス別集計・年間集計
    PrintPreviewDialog.tsx # 印刷プレビューダイアログ
    ExportDialog.tsx      # Excelエクスポートダイアログ
    PatchImportDialog.tsx # パッチインポートダイアログ
    SettingsDialog.tsx    # 学期設定ダイアログ
    HolidaySettingsDialog.tsx # 祝日・休校日設定
    ColorSettingsDialog.tsx   # クラス色設定
    AutoRestoreDialog.tsx     # 自動復元確認ダイアログ
    SemesterTabs.tsx      # 学期切り替えタブ
  contexts/
    TimetableContext.tsx  # グローバル状態管理
    GradeColorContext.tsx # クラス色管理
    ThemeContext.tsx      # テーマ管理
  lib/
    timetable.ts          # データモデル・演算エンジン
    timetableFile.ts      # ファイル形式・シリアライズ
    gradeColors.ts        # クラス色定義
    exportUtils.ts        # エクスポートユーティリティ
    timetableSvgExport.ts # SVGベースエクスポート
  pages/
    Home.tsx              # メインページ
```

---

## パッチインポートの使い方

特定の期間（例：運動会練習期間）だけ時間割を変更したい場合は、`timetable-patch/v1` 形式のJSONファイルを作成してインポートします。

1. `README_import.md` を参照してJSONファイルを作成（またはLLMに生成させる）
2. 右上の「**インポート**」ボタンをクリック、またはJSONファイルをアプリにドラッグ＆ドロップ
3. 確認ダイアログでモード（部分書き換え / 全書き換え）と対象日付を確認
4. 「適用」をクリック

変更は「変更履歴」タブで確認・取り消しができます。

---

## 開発・ビルド

```bash
# 依存関係のインストール
pnpm install

# 開発サーバー起動
pnpm dev

# ビルド
pnpm build
```

---

## 注意事項

- このアプリはフロントエンドオンリーです。データはブラウザのlocalStorageと `.timetable` ファイルに保存されます。
- `.timetable` ファイルは定期的にダウンロードして手元に保管することを推奨します。
- 複数のブラウザ・デバイスでの同期には対応していません。
