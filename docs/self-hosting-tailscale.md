# スマホ連動を「このMac＋Tailscale」で動かす（Vercel不要）

**結論: Vercelを使わなくてもスマホ連動は完成する。** MacBook Pro を同期サーバにして、
Tailscale の閉じたネットワーク経由で iPhone から到達する構成。設定済み・稼働確認済み。

## なぜこれが良いか
- **Vercelの設定作業が丸ごと不要**（プロジェクト作成・KV接続・ブランチ切替・環境変数）。
- データはこの Mac の中だけ（`.sync-data/`）。外部クラウドを一切経由しない。
- Tailscale は既に導入済みで、**この Mac と iPhone 15 Pro が同じ tailnet に参加済み**だった。
- 学校からでも自宅からでも、Tailscale が繋がっていれば同じURLで届く（ポート開放不要・経路は暗号化）。

## 構成
```
iPhone (PWA)  ──Tailscale(暗号化)──▶  MacBook Pro :3000
  ブラウザ/ホーム画面アプリ              express(dist/index.js)
                                        ├ 静的配信（アプリ本体）
                                        └ /api/sync（同期API）→ .sync-data/
```

## アクセス先（固定）
- **`http://ryon-book-m5pro:3000`** … MagicDNS の固定ホスト名（IP変動に強い・推奨）
- `http://100.125.69.56:3000` … Tailscale IP（直接指定する場合）

## 同期トークン
`.sync-data/token.txt` に自動生成される値を Mac / iPhone 双方の「スマホ連動」に入力する。
（環境変数 `SYNC_TOKEN` を指定すればそれが優先される）

## セットアップ状態（実施済み）
1. `npm run build` … 本番ビルド（`dist/`）
2. `scripts/start-sync-server.sh` … 起動スクリプト
3. `~/Library/LaunchAgents/com.ryon.timetable-sync.plist` … **ログイン時に自動起動**（KeepAlive=常駐）
   - ログ: `/tmp/timetable-sync.log` / `/tmp/timetable-sync.err`

### 使い方（iPhone）
1. Safari で **`http://ryon-book-m5pro:3000`** を開く → 共有 → **ホーム画面に追加**（PWA化）
2. サイドバー「スマホ連動」→ **サーバURLは空欄のまま**（同一オリジンのため）→
   **トークン**に `.sync-data/token.txt` の値を入力 → 有効にする
3. Mac 側も同様に「スマホ連動」を有効化（Macは「このMacから」ボタンでトークン自動取得可）

### 運用コマンド
```bash
# 状態確認
launchctl list | grep timetable-sync
curl http://ryon-book-m5pro:3000/api/sync/health

# 停止 / 開始
launchctl unload ~/Library/LaunchAgents/com.ryon.timetable-sync.plist
launchctl load   ~/Library/LaunchAgents/com.ryon.timetable-sync.plist

# コード更新を反映（ビルドし直すと自動で再起動される）
cd timetable-web && npm run build
```

## 注意
- **Mac がスリープ／電源オフだと同期できない**（閲覧はPWAのキャッシュで可能）。常時使いたいなら
  `ryon-mini-server`（同じ tailnet に active）へ同じ構成を移すのが最適。手順は本書と同じ。
- 取得ブラウザ（指導計画の改訂チェック）は python 依存。この自前サーバなら **動く**
  （Vercelでは動かなかった）。むしろ自前サーバの方が機能が揃う。
- Vercel 版（`api/sync/[...path].ts` + `vercel.json` + KVアダプタ）は実装済みのまま残してある。
  将来「Macを開いていなくても同期したい」時に、そちらへ切り替えられる。
