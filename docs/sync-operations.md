# 同期の運用ガイド（サーバ移行・ユーザー向け提供方針）

## 1. いまの構成（このMacで運用中）
```
iPhone (PWA) ──Tailscale──▶ ryon-book-m5pro:3000
                              express（LaunchAgentで常駐）
                              └ .sync-data/（スナップショット＋版履歴＋トークン）
```
- Macがスリープ／電源オフの間は同期できない（閲覧はPWAキャッシュで可）。
- 常時稼働させたくなったら → 下の「2. mini-serverへの移行」。

## 2. mini-server への移行（下準備だけ済み・実行はいつでも）
移行は**2コマンド**でできるようにしてある。まだ実行しなくてよい。

### 手順
```bash
# ① 同期データ（スナップショット＋トークン）を移行先へコピー
#    トークンごと持っていくので iPhone 側の再設定が不要
bash scripts/migrate-sync-data.sh ryon-mini-server

# ② 移行先のMacで、サーバをセットアップ（ビルド＋常駐登録＋疎通確認）
ssh ryon-mini-server
cd ~/timetable_app_manus_claude/timetable-web   # 事前に git clone しておく
bash scripts/setup-sync-server.sh
```

### 移行後
```bash
# このMacの同期サーバを止める
launchctl unload ~/Library/LaunchAgents/com.ryon.timetable-sync.plist
```
アプリの「スマホ連動」→ サーバURLを `http://ryon-mini-server:3000` に変更（トークンは同じ）。

### 事前に必要なこと（移行先で一度だけ）
- Node.js と pnpm（または npm）
- Tailscale にログイン済み（同じ tailnet）
- SSH 有効化：システム設定 → 一般 → 共有 → **リモートログイン** をON
- リポジトリを clone

## 3. ユーザー向けにはどう提供するか

いまの「自宅サーバ＋Tailscale＋トークン」は**自分用として最適**だが、一般の先生には難しい。
配布を考えるなら、段階を分けるのが自然。

| 段階 | 方式 | 向いている相手 | 手間 |
|---|---|---|---|
| **A. 同期なし（既定）** | 端末内に保存（localStorage）＋ファイル書き出し | 大多数。1台で完結する人 | ゼロ |
| **B. Google Drive 同期** | 既存実装（appDataFolder・実装済み） | 複数端末で使いたい人 | Googleログインのみ |
| **C. 自前サーバ同期** | 本機能（URL＋トークン） | 学校/自治体で閉じた運用をしたい所 | サーバ用意が必要 |

**推奨の提供形**
1. 既定は **A**。同期は「使いたい人だけ設定する」オプションに留める（今の実装どおり、同期OFFなら
   従来の操作性がそのまま＝復元ダイアログも従来通り）。
2. 複数端末で使いたい一般ユーザーには **B（Drive）** を案内。**追加インフラ不要**でいちばん現実的。
3. **C** は「学校で閉じて運用したい」ケース向けに、サーバ構築手順（本書＋`setup-sync-server.sh`）を
   添えて提供する。児童に関わる情報を外部に出したくない自治体では、むしろこれが求められる。

**設計上そうなっている点**
- 同期は `SyncStore` 抽象なので、置き場所（ローカルFS / Vercel KV）を差し替えられる。
- 同期OFF時は既存挙動を一切変えない（機能追加が既存ユーザーの邪魔をしない）。

**将来やるなら**
- 招待リンク方式（サーバURL＋トークンを1つのQRにして読ませる）にすれば、
  スマホ側の入力がゼロになる。学校配布ならこれが現実的。

## 4. 運用コマンド早見
```bash
# 状態
launchctl list | grep timetable-sync
curl http://ryon-book-m5pro:3000/api/sync/health

# ログ（どの端末がいつ同期したか）
grep '\[sync\]' /tmp/timetable-sync.log | tail -20

# 停止 / 開始
launchctl unload ~/Library/LaunchAgents/com.ryon.timetable-sync.plist
launchctl load   ~/Library/LaunchAgents/com.ryon.timetable-sync.plist

# コード更新の反映
npm run build && launchctl kickstart -k gui/$(id -u)/com.ryon.timetable-sync
```
