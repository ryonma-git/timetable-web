# Claude Code 再開手順書

> 作成日: 2026-05-07  
> 対象バージョン: v58（GitHub Pages 404修正・Wouter base設定）

---

## 現在の状況

- **Manus 側**: v58 チェックポイント保存済み・GitHub に push 済み
- **GitHub Pages**: `https://ryonma-git.github.io/timetable-web/` にデプロイ済み（Wouter base 修正後に正常表示予定）
- **Claude Code**: トークン切れで停止中

---

## Step 1: ローカルに最新を取り込む

```bash
cd ~/path/to/timetable-web   # リポジトリのフォルダに移動
git pull
```

取り込まれる主な変更（Manus v56〜v58）:
- 祝日コマの時数計算バグ修正（`TimetableContext.tsx` / `StatsView.tsx`）
- GitHub Pages SPA 404対策（`client/public/404.html` 追加・`client/index.html` にリダイレクトスクリプト）
- Wouter の `base` 設定（`client/src/App.tsx`）
- `CLAUDE_CODE_HANDOFF.md` 更新

---

## Step 2: `deploy.yml` の pnpm バージョン固定（1回だけ必要）

Manus の GitHub App トークンにはワークフローファイルの書き込み権限がないため、この修正だけローカルから push する必要があります。

```bash
# .github/workflows/deploy.yml を開いて以下を探す:
#   - uses: pnpm/action-setup@v4
#
# ↓ 以下に変更する（with: version: 10 を追加）:
#   - uses: pnpm/action-setup@v4
#     with:
#       version: 10
```

エディタで開く場合:
```bash
open .github/workflows/deploy.yml
# または
code .github/workflows/deploy.yml
```

変更後にコミット＆プッシュ:
```bash
git add .github/workflows/deploy.yml
git commit -m "fix: pnpm version 10 固定"
git push
```

---

## Step 3: GitHub Pages の設定確認（まだなら）

1. `https://github.com/ryonma-git/timetable-web/settings/pages` を開く
2. Source が **GitHub Actions** になっているか確認
3. なっていなければ **GitHub Actions** に変更して保存

---

## Step 4: デプロイ確認

```bash
# push 後 2〜3分待ってから確認
open https://github.com/ryonma-git/timetable-web/actions
# 緑チェックが付いたら:
open https://ryonma-git.github.io/timetable-web/
```

---

## Step 5: Claude Code で開発再開

```bash
# リポジトリのフォルダで
claude
```

起動後、まず引き継ぎ書類を読ませる:
```
CLAUDE_CODE_HANDOFF.md を読んで、このプロジェクトの概要を把握してください
```

---

## Manus との連携フロー（今後）

```
Claude Code（ローカル）
    ↕ git push / git pull
   GitHub（ryonma-git/timetable-web）
    ↕ checkpoint（自動 push/pull）
Manus（クラウド）→ Publish → timetableapp-ee4m7qag.manus.space
```

- **Claude Code で修正** → `git push` → GitHub Actions が自動デプロイ
- **Manus に反映したい場合** → Manus のチャットで「GitHub から最新を取り込んで Publish して」と依頼
- **Manus で修正後** → ローカルで `git pull` して取り込む

---

## 注意事項

- Manus と Claude Code で**同じファイルを同時編集するとコンフリクト**が発生します。「今は Manus で作業中」「今は Claude Code で作業中」と役割を分けるのが安全です
- `deploy.yml` の変更は Manus からは push できません（権限制限）。ワークフロー変更は必ず Claude Code（ローカル）から push してください
- 次回 Manus に依頼する際は「最新を GitHub から取り込んで」と一言添えると確実です

---

## 現在の既知の未実装・改善候補

1. **Cmd+S / Ctrl+S ショートカット**: 上書き保存をキーボードショートカットで実行
2. **振替授業の管理**: 祝日に振り替えた授業の追跡機能
3. **印刷レイアウト**: 時間割の印刷用 CSS 最適化
4. **複数クラスの一括設定**: 同じ学年の複数クラスに同じ時間割を適用
