#!/bin/bash
# 同期データ（.sync-data/）を別のMacへ引き継ぐ。
#
# 移行先で setup-sync-server.sh を実行する「前」に使うと、
# これまでのスナップショットと同期トークンをそのまま持ち越せる
# （＝iPhone側の設定を変えずに済む）。
#
# 使い方（移行元＝いまのMacで実行）:
#   bash scripts/migrate-sync-data.sh ryon-mini-server
#   bash scripts/migrate-sync-data.sh ryon-mini-server /path/to/repo/on/target
#
# 前提: 移行先に Tailscale で到達でき、SSH が有効なこと
#       （システム設定 → 一般 → 共有 → リモートログイン をON）

set -euo pipefail

TARGET="${1:-}"
REMOTE_REPO="${2:-~/timetable_app_manus_claude/timetable-web}"
if [ -z "$TARGET" ]; then
  echo "使い方: bash scripts/migrate-sync-data.sh <移行先ホスト名> [移行先のリポジトリパス]"
  echo "例:     bash scripts/migrate-sync-data.sh ryon-mini-server"
  exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/.sync-data"

if [ ! -d "$SRC" ]; then
  echo "✗ 同期データが見つかりません: $SRC"
  exit 1
fi

echo "▶ 移行元: $SRC"
echo "▶ 移行先: $TARGET:$REMOTE_REPO/.sync-data"
echo ""
echo "  スナップショット: $(ls "$SRC"/snapshot.json 2>/dev/null | wc -l | tr -d ' ') 件"
echo "  版履歴:           $(ls "$SRC"/versions/*.json 2>/dev/null | wc -l | tr -d ' ') 件"
echo "  トークン:         $([ -f "$SRC/token.txt" ] && echo 'あり（引き継ぐとiPhone側の再設定が不要）' || echo 'なし')"
echo ""
read -r -p "この内容で転送しますか？ [y/N] " ans
case "$ans" in [yY]*) ;; *) echo "中止しました"; exit 0 ;; esac

# 移行先にディレクトリを用意してから rsync
ssh "$TARGET" "mkdir -p $REMOTE_REPO/.sync-data"
rsync -av --progress "$SRC/" "$TARGET:$REMOTE_REPO/.sync-data/"

echo ""
echo "─────────────────────────────────────────────"
echo " 転送完了"
echo "─────────────────────────────────────────────"
echo " 次の手順（移行先のMacで）:"
echo "   cd $REMOTE_REPO"
echo "   bash scripts/setup-sync-server.sh"
echo ""
echo " そのあと、このMacの同期サーバを止める:"
echo "   launchctl unload ~/Library/LaunchAgents/com.ryon.timetable-sync.plist"
echo ""
echo " iPhone / Mac のアプリで「スマホ連動」のサーバURLを"
echo "   http://$TARGET:3000  に変更（トークンは同じものが使えます）"
echo "─────────────────────────────────────────────"
