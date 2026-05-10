# timetable-web 引き継ぎドキュメント

> **対象**: Claude Code / Codex などのコーディングエージェント  
> **作成日**: 2026-05-10  
> **前担当**: Manus AI（v22〜v74 を実装）

---

> **⚠️ 最新版のドキュメントは必ず GitHub を参照してください**  
> このファイルはローカルコピーです。最新情報は以下の GitHub 上のファイルを確認してください。
>
> | ドキュメント | GitHub URL |
> |-------------|------------|
> | **このファイル（HANDOVER.md）** | https://github.com/ryonma-git/timetable-web/blob/main/HANDOVER.md |
> | **更新履歴・概要（README.md）** | https://github.com/ryonma-git/timetable-web/blob/main/README.md |
> | **リポジトリトップ** | https://github.com/ryonma-git/timetable-web |

---

## 1. リポジトリの取得（最初にやること）

```bash
# GitHub からクローン（初回）
git clone https://github.com/ryonma-git/timetable-web.git
cd timetable-web

# 既にローカルにある場合は最新版を pull
cd timetable-web
git pull user_github main
# または
git pull origin main

# 依存パッケージのインストール
pnpm install

# 開発サーバー起動
pnpm dev
```

> **注意**: `origin` は Manus 内部の S3 リポジトリを指しています。  
> 外部からアクセスする場合は `user_github` リモート（GitHub）を使ってください。  
> GitHub URL: `https://github.com/ryonma-git/timetable-web`

---

## 2. プロジェクト概要

**体育教師向け週間時間割管理 Web アプリ**。  
教科担任・学級担任の両モードに対応し、Google Drive 自動同期・Google カレンダー連携・PDF/Excel 書き出しを備えたフロントエンドオンリーの PWA。

| 項目 | 内容 |
|------|------|
| **スタック** | React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + Wouter + Vite |
| **デザイン** | Swiss Grid × Japanese Functional Design（モノクロームベース、アンバーアクセント） |
| **データ永続化** | localStorage（自動保存）＋ `.timetable` ファイル（JSON）＋ Google Drive（任意） |
| **ビルド** | `pnpm build` → `dist/` |
| **テスト** | `pnpm test`（vitest、回帰テストのみ） |
| **デプロイ先** | `https://timetableapp-ee4m7qag.manus.space`（Manus ホスティング） |

---

## 3. ディレクトリ構成

```
timetable-web/
├── client/
│   ├── index.html              # GIS スクリプト読み込み
│   ├── public/                 # PWA アイコン・manifest.json・SW
│   └── src/
│       ├── App.tsx             # ルーティング（Wouter）
│       ├── index.css           # Tailwind テーマ変数（ここを変えると全体に影響）
│       ├── components/
│       │   ├── Sidebar.tsx     # 左サイドバー（ファイル操作・Google Drive UI）
│       │   ├── WeekGrid.tsx    # 週間グリッド（メイン表示）
│       │   ├── Inspector.tsx   # セル詳細・編集パネル
│       │   ├── ExportDialog.tsx # PDF/Excel/ICS/PNG 書き出しダイアログ
│       │   ├── NewFileWizard.tsx # 新規作成ウィザード（5ステップ）
│       │   ├── StatsView.tsx   # クラス別・教科別集計
│       │   ├── PrintPreviewDialog.tsx # 印刷プレビュー
│       │   ├── PatchImportDialog.tsx  # パッチインポート
│       │   ├── DriveBackupDialog.tsx  # Drive バックアップ一覧
│       │   ├── LLMImportDialog.tsx    # LLM 読み取りヘルパー
│       │   └── ui/             # shadcn/ui コンポーネント群
│       ├── contexts/
│       │   ├── TimetableContext.tsx   # グローバル状態管理（最重要）
│       │   ├── GoogleDriveContext.tsx # Google Drive / GIS 認証管理
│       │   ├── GradeColorContext.tsx  # クラス色管理
│       │   └── ThemeContext.tsx       # ダーク/ライトテーマ
│       ├── lib/
│       │   ├── timetable.ts          # applyOverrides 演算エンジン
│       │   ├── timetableFile.ts      # .timetable ファイルの直列化
│       │   ├── googleDrive.ts        # GIS トークン管理・Drive API 呼び出し
│       │   ├── exportUtils.ts        # Excel 書き出し（ExcelJS）
│       │   ├── timetablePdfExport.ts # PDF 書き出し（jsPDF 直接描画）
│       │   ├── icsExport.ts          # ICS 書き出し
│       │   └── llmImport.ts          # LLM 連携テンプレート生成
│       └── pages/
│           └── Home.tsx              # メインページ（ダイアログ状態管理）
├── references/
│   ├── patch_format.md         # パッチインポート形式仕様
│   └── data_model.md           # 全型定義の詳細
└── skills/timetable-app/SKILL.md  # Manus 用スキルファイル（設計判断の記録）
```

---

## 4. コアデータモデル

```typescript
// 1コマ分
interface PeriodSlot {
  period: number;
  class: string | null;
  subject?: string | null;  // 教科担任モード用
  reason?: string;
}

// 変更操作（演算エンジンへの入力）
interface OverrideOp {
  op: "set_period_class" | "clear_period_class" | "set_period_reason" | "set_day_reason";
  date: string;       // "YYYY-MM-DD"
  period?: number;
  class?: string | null;
  subject?: string | null;
  reason?: string;
  target_class?: string | null;
  replace?: boolean;
  clear_all_classes?: boolean;
}
```

**演算モデル**: `base[]`（基本時間割）+ `ops[]`（変更操作）→ `effective[]`（実効時間割）  
`applyOverrides()` 関数（`lib/timetable.ts`）で計算。変更は必ず `ops` に追記し、`base` は直接書き換えない。

---

## 5. Google Drive / GIS 認証の設計

### 認証フロー

```
ページロード
  → GIS スクリプト読み込み待ち（200ms ポーリング）
  → initGoogleAuth() でトークンクライアント初期化
  → Google One Tap 初期化（auto_select:true、HTTPS 環境のみ有効）
      → One Tap コールバック → requestAccessToken("") でサイレント取得
  → localStorage に "gdrive_logged_in"="1" があれば
      requestAccessToken("") でサイレント取得を試みる
  → 5秒以内にトークンが取れれば isLoggedIn=true
  → 失敗すれば silentRestoreFailed=true → 警告バナー表示

トークン取得成功時
  → 55分後に自動サイレント更新タイマーをセット（useRef管理）
  → ページを開いている間はログインが切れない
  → ログアウト時にタイマーをクリア
```

### 重要な定数（`client/src/lib/googleDrive.ts`）

```typescript
export const GOOGLE_CLIENT_ID =
  "693809505459-k6n5u58rkccfelk5vi8nl0ee1k34435c.apps.googleusercontent.com";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",    // 自動同期
  "https://www.googleapis.com/auth/drive.file",        // 手動バックアップ
  "https://www.googleapis.com/auth/calendar.events",   // カレンダー書き込み
  "https://www.googleapis.com/auth/calendar.readonly", // カレンダー一覧取得
].join(" ");
```

### GoogleDriveContext が公開する値

| 値 / 関数 | 説明 |
|-----------|------|
| `isLoggedIn` | トークン有効フラグ |
| `isRestoringLogin` | サイレント復元中フラグ（ローディング表示用） |
| `silentRestoreFailed` | 復元失敗フラグ（警告バナー表示用） |
| `login()` | 通常ログイン（consent 画面） |
| `relogin()` | 再認証（既ログイン時でも consent 再表示） |
| `requestCookieAccess()` | Storage Access API でサードパーティ Cookie 許可要求 |
| `syncToDrive()` | appDataFolder へ自動同期 |
| `backupToMyDrive()` | マイドライブ/時間割管理/ に手動バックアップ |
| `loadFromDrive()` | appDataFolder から復元 |
| `getBackupFiles()` | バックアップ一覧取得 |
| `handleDriveSave()` | ローカル保存なしで Drive 隠しフォルダのみ更新（Sidebar.tsx 内の関数） |

---

## 6. v22〜v72 の主要変更履歴

以下は Manus が実装した主要機能の一覧です（古い順）。

| バージョン | 主な変更内容 |
|-----------|-------------|
| v22〜v24 | 初期リリース。学級担任/教科担任モード、ウィザード、基本グリッド |
| v25〜v26 | 週移動ナビゲーション、時程表入力（PeriodTimesDialog）、ICS 書き出し |
| v28〜v31 | 時程表の曜日別設定、LLM 読み取りヘルパー（ウィザード各ステップ） |
| v32〜v34 | LLMImportDialog 全面刷新、ファイル読み込み時のビュー初期化修正 |
| v35〜v36 | 未保存警告バナー、PWA 化（manifest / Service Worker） |
| v37〜v38 | モバイル対応（ボトムシート Drawer、ヘッダー折りたたみ） |
| v39〜v40 | タッチ長押しドラッグ＆ドロップ（モバイル） |
| v41〜v50 | Google Drive 自動同期・手動バックアップ・復元機能 |
| v51〜v60 | PDF 書き出し（jsPDF 直接描画、NotoSansJP 埋め込み） |
| v61〜v64 | Excel 書き出し改善、印刷プレビュー強化 |
| v65〜v66 | Google カレンダー連携（重複防止 UID 管理、イベント名形式選択） |
| v67 | Drive バックアップ一覧ダイアログ、Google カレンダー一括削除 |
| v68 | バックアップ削除ボタン、ExportDialog 統合（生データタブ）、GCal タブ改善 |
| v69 | Drive 削除 UI 全面改修（タグ付き削除/期間指定削除、2段階確認） |
| v70 | ヘッダー「生データ」ドロップダウン削除→ExportDialog に統合 |
| **v71** | ログイン永続化（isRestoringLogin）、書き出し sonner トースト（PDF/Excel/ICS）、月単位 Select 改善 |
| **v72** | サイレントログイン失敗アラート、Cookie 許可リクエスト（Storage Access API）、再認証ボタン |
| **v73** | Drive同期のみボタン追加（ローカル保存なし）、ICS/Google連携タブ全面改修（プレビュー縮小・削除セクション折りたたみ・フッターに「カレンダーに追加」「ICSでダウンロード」ボタン配置） |
| **v74** | 全形式共通のプレビュートグル実装（「プレビューを表示/非表示」ボタン）、ICSタブはデフォルト非表示・設定項目全表示、PDF/Excelはデフォルト表示。暫定安定版 |
| **v75** | Googleログイン永続化（55分トークン自動更新タイマー + Google One Tap）← Claude Code 実装。ただし未検証のため安定版扱いしない |
| **v76** | 言語切替の初期実装（`LanguageContext`、左下メニューの日本語/英語切替、サイドバー/上部操作の一部英語化）。Codex 実装。ただし未検証のため安定版扱いしない |
| **v77** | 英語表示範囲を週間グリッド、自動復元、変更確認、学期タブへ拡張。Codex 実装。ただし未検証のため安定版扱いしない |
| **v78** | 英語表示範囲を統計・履歴・適用ログ画面へ拡張。Codex 実装。ただし未検証のため安定版扱いしない |
| **v79** | One Tapログイン修正（login_hint追加でGISがアカウント特定、初回/既存ユーザー分岐）。Claude Code 実装。ただし未検証のため安定版扱いしない |
| **v80** | 「学期を追加」ボタンをテキスト付きに変更し視認性を改善。Claude Code 実装。ただし未検証のため安定版扱いしない |
| **v81** | SemesterTabsバグ修正（semesters配列形式でsemesterがnullになる問題）、Google One Tap無効化。Claude Code 実装。ただし未検証のため安定版扱いしない |
| **v82** | ログイン成功時にメールをlocalStorageに保存し、サイレント復元時のlogin_hintとして使用（復元成功率を向上）。Claude Code 実装。ただし未検証のため安定版扱いしない |

---

## 7. 既知の課題・未実装事項

以下は今後対応が必要な課題です。

### 高優先度

1. **書き出しのバックグラウンド処理**  
   現在は sonner トーストで「ダイアログを閉じても処理継続」の UX を提供しているが、実際には処理はメインスレッドで同期的に実行されている。大量データ（全学期・全週）の PDF 生成時にブラウザが固まる場合がある。  
   → 対策: Web Worker への移行を検討。

   **Drive同期のみ**（v73追加）: `handleDriveSave()` を呼び出す。この関数は `TimetableContext` の `save()` を呼ばずに `syncToDrive()` だけを実行する。`Sidebar.tsx` の `isLoaded && (...)` ブロック内に配置。

3. **PNG 書き出し**  
   ExportDialog に「PNG」タブは存在するが未実装（`timetableSvgExport.ts` は無効化中）。  
   → 対策: jsPDF の `doc.output("datauristring")` → Canvas 変換、または html-to-image ライブラリを検討。

### 中優先度

4. **月単位モードのプレビュー**  
   月単位で書き出す際、選択した月に何週あるかのバッジ表示がない。

5. **Google Drive 同期エラーの詳細表示**  
   エラー時はサイドバーに「同期エラー」と表示されるだけで、エラーコードと対処法が見えない。

6. **v75 Googleログイン永続化の実機検証**
   v75 でトークン取得時に 55 分後のサイレント更新タイマーと Google One Tap を実装済み。ただし利用者確認前のため未検証扱い。HTTPS 環境で One Tap、サイレント復元、55分更新、再認証、ログアウト時のタイマー解除を確認してから安定版に昇格する。

7. **v76〜v78 言語切替の全画面展開**
   v76 では `client/src/contexts/LanguageContext.tsx` を追加し、サイドバーとトップバーの主要文言だけを段階的に英語化した。v77 で週間グリッド、自動復元、変更確認、学期タブ、v78 で統計・履歴・適用ログ画面まで拡張済み。日本語画面をデフォルトとして維持し、各ダイアログ、トースト、PDF/Excel/ICS内の固定文言は同じ `t()` 方式で順次移行する。

---

## 8. 開発時の注意事項

### やってはいけないこと

- **`html2canvas` の使用禁止**: CSS 変数・Tailwind クラスを解決できないため PDF/PNG 生成に使用しない。
- **`base` を直接書き換えない**: 変更は必ず `ops` に追記し、`applyOverrides()` で計算する。
- **`server/` ディレクトリの変更禁止**: このプロジェクトはフロントエンドオンリー。`server/` は互換性プレースホルダー。
- **`react-toastify` の追加禁止**: トースト通知は `sonner` を使用する（`import { toast } from "sonner"`）。

### TypeScript エラーの確認方法

```bash
cd timetable-web
npx tsc --noEmit
```

変更後は必ずこれを実行してエラーがないことを確認する。

### 更新後の報告ルール

`main` へ push した更新は GitHub Pages に自動デプロイされる。push 後の最終報告では、ユーザーが確認しに行けるように公開ページ `https://ryonma-git.github.io/timetable-web/` を毎回貼る。

### 新機能追加のパターン

**コンテキストに新しいアクションを追加する場合:**
1. `TimetableContextValue` インターフェースにメソッドを追加
2. `TimetableProvider` 内で `useCallback` で実装
3. `value` オブジェクトに追加

**新しいダイアログを追加する場合:**
1. `client/src/components/` に新コンポーネントを作成
2. `Home.tsx` で `useState` で open 状態を管理
3. `Home.tsx` の右上ボタンエリアまたはドロップダウンに追加

---

## 9. 環境変数・外部サービス

このアプリは環境変数を使用しない（フロントエンドオンリーのため）。  
外部サービスとの接続情報はすべてソースコードに直接記述されている。

| サービス | 設定箇所 | 値 |
|---------|---------|-----|
| Google OAuth | `client/src/lib/googleDrive.ts` | CLIENT_ID: `693809505459-...` |
| Google Drive API | 同上 | REST API を fetch で直接呼び出し |
| Google Calendar API | 同上 | REST API を fetch で直接呼び出し |

**Google Cloud Console での設定（変更時に必要）:**
- プロジェクト: 上記 CLIENT_ID に対応するプロジェクト
- 承認済みの JavaScript 生成元: デプロイ先 URL を追加する必要がある
- OAuth 同意画面: テスト用ユーザーを追加しないと他のユーザーが使えない

---

## 10. スキルファイルについて

`/skills/timetable-app/SKILL.md`（Manus 環境内）に、より詳細な設計判断・バグ対処法・実装パターンが記録されている。Claude Code / Codex 環境では参照できないが、上記の内容はそこから抜粋・更新したものである。

---

*以上が引き継ぎに必要な情報です。不明点があれば `references/` ディレクトリのドキュメントも参照してください。*
