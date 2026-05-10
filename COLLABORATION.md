# timetable-web 共同開発ガイド

> **対象**: Claude Code / Codex / Manus など、このリポジトリに関わるすべてのエージェント  
> **最終更新**: 2026-05-10

---

## ブランチ構成

```
stable            ← 配布・公開ブランチ（GitHub Pages）
                    ユーザーが検証・承認したバージョンのみ
                    ※ 直接コミット禁止。main からのマージのみ
main              ← 統合ブランチ（常に最新の開発状態）
                    各エージェントのブランチをここにマージする
├── claude/...    ← Claude Code 担当
├── codex/...     ← Codex 担当
└── manus/...     ← Manus 担当（回復後）
```

### 各ブランチの役割

| ブランチ | 役割 | GitHub Pages |
|---------|------|-------------|
| `stable` | 検証済み安定版（現在 v74） | ✅ デプロイ対象 |
| `main` | 統合・開発（最新） | ❌ デプロイしない |
| `claude/...` | Claude Code 作業ブランチ | ❌ |
| `codex/...` | Codex 作業ブランチ | ❌ |
| `manus/...` | Manus 作業ブランチ | ❌ |

---

## 作業フロー

```
1. 自分の担当ブランチで実装・コミット
   └─ claude/google-login, codex/i18n-en, manus/... など

2. 実装完了 → main にマージ
   └─ マージ前に必ず確認（後述）

3. ユーザーが main の動作を検証

4. ユーザーが承認 → stable にマージ → GitHub Pages に反映
```

---

## 作業開始前の必須確認

```bash
# 現在のブランチと状態を確認
git status --short --branch

# 全ブランチの履歴を確認
git log --oneline --decorate --graph --all -12
```

---

## main へのマージ前チェックリスト

```bash
# 自分のブランチに含まれる未マージコミットを確認
git log --oneline --decorate --graph main..HEAD
```

✅ 確認すること:
- 自分が書いたコミットのみが含まれている
- 他エージェントのコミットが混入していない
- バージョン番号が main の最新から連番になっている

---

## バージョン番号ルール

- `main` の最新バージョンを確認してから連番を付ける
  ```bash
  grep "\*\*v" HANDOVER.md | tail -5
  ```
- **安定版は `stable` ブランチの内容のみ**（現在 v74）
- ユーザーが明示するまで v74 以降に「安定版」とは付けない
- v75 以降は README / HANDOVER に「未検証」と記載する

---

## ドキュメント更新ルール

main へのマージ時に必ず以下を更新してコミットする:

| ファイル | 更新内容 |
|---------|---------|
| `README.md` | 最新実装バージョン番号、更新履歴に新バージョン追記 |
| `HANDOVER.md` | 変更履歴テーブルに新バージョン追記、該当セクションを更新 |

---

## コンフリクト解消ルール

- **機械的な ours/theirs は禁止**
- 競合箇所のコードを必ず読み、両者の意図を理解してから解消する
- 特に競合しやすい領域:
  - `GoogleDriveContext.tsx` / `googleDrive.ts`（Claude Code担当）
  - `LanguageContext.tsx` / 各コンポーネントの `t()` 呼び出し（Codex担当）
- 不明な場合はユーザーに確認する

---

## 担当領域の目安

| 領域 | 主担当 |
|-----|-------|
| Googleログイン・Drive・Calendar 認証まわり | Claude Code |
| 言語切替（i18n）・UI テキスト | Codex |
| 全体設計・新機能・バグ修正全般 | Manus（回復後） |

※ 担当外の領域に触れる場合は、先にユーザーへ確認する

---

## Manus 固有の注意事項

Manus は独自サーバーに GitHub のミラーを持っている。  
- `main` ブランチを常に GitHub と同期させること
- Manus 作業ブランチ（`manus/...`）は GitHub の `main` をベースに作成する
- ミラーと GitHub の差分が生じた場合はユーザーに報告する

---

## push 後の報告フォーマット

```
✅ [ブランチ名] にプッシュしました
バージョン: vXX
変更内容: ...
公開URL（stableマージ後のみ）: https://ryonma-git.github.io/timetable-web/
```

---

*このドキュメントはブランチ運用が変わった際に更新してください。*
