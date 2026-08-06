#!/bin/bash
# 同期サーバを別のMac（例: ryon-mini-server）へ移すためのセットアップ。
#
# 移行しなくても、このMacで再構築する時にもそのまま使える（冪等）。
# やること:
#   1. ビルド（dist/ が無ければ作る）
#   2. LaunchAgent を作成して常駐登録（ログイン時に自動起動）
#   3. 疎通確認とトークン表示
#
# 使い方（移行先のMacで、リポジトリを clone した後に実行）:
#   bash scripts/setup-sync-server.sh
#   bash scripts/setup-sync-server.sh --port 3000
#
# 前提: Node.js と pnpm/npm、Tailscale が入っていること。

set -euo pipefail

PORT=3000
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    *) echo "不明な引数: $1"; exit 1 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.ryon.timetable-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "▶ リポジトリ: $REPO"
echo "▶ ポート: $PORT"

# --- 1. 依存とビルド ---------------------------------------------------------
cd "$REPO"
if [ ! -d node_modules ]; then
  echo "▶ 依存をインストールします…"
  if command -v pnpm >/dev/null; then pnpm install; else npm install; fi
fi
echo "▶ ビルドします…"
npm run build

# --- 2. LaunchAgent 登録 -----------------------------------------------------
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/start-sync-server.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/timetable-sync.log</string>
  <key>StandardErrorPath</key><string>/tmp/timetable-sync.err</string>
</dict>
</plist>
XML
echo "▶ LaunchAgent を登録: $PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 3

# --- 3. 疎通確認 -------------------------------------------------------------
echo ""
echo "▶ 疎通確認"
if curl -s --max-time 6 "http://localhost:$PORT/api/sync/health" ; then
  echo ""
else
  echo "  ✗ 応答なし。/tmp/timetable-sync.err を確認してください"; exit 1
fi

HOSTNAME_TS="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys;print((json.load(sys.stdin).get("Self") or {}).get("DNSName","").rstrip("."))' 2>/dev/null || true)"
SHORT="${HOSTNAME_TS%%.*}"
echo ""
echo "─────────────────────────────────────────────"
echo " セットアップ完了"
echo "─────────────────────────────────────────────"
[ -n "$SHORT" ] && echo " iPhoneからのURL:  http://$SHORT:$PORT"
echo " 同期トークン:      $(cat "$REPO/.sync-data/token.txt" 2>/dev/null || echo '(初回アクセス時に生成されます)')"
echo ""
echo " 次の手順:"
echo "  1. iPhone / Mac で上記URLを開く"
echo "  2. サイドバー「スマホ連動」→ サーバURLは空欄 → トークンを入力 → 有効化"
echo ""
echo " 運用コマンド:"
echo "  停止: launchctl unload $PLIST"
echo "  開始: launchctl load $PLIST"
echo "  ログ: tail -f /tmp/timetable-sync.log"
echo "─────────────────────────────────────────────"
