#!/bin/bash
# 時間割アプリの自前サーバ（同期API込み）を起動する。
# Tailscale経由で iPhone から http://ryon-book-m5pro:3000 で到達できる。
cd "$(dirname "$0")/.." || exit 1
export NODE_ENV=production
export PORT="${PORT:-3000}"
# SYNC_TOKEN は未指定なら .sync-data/token.txt が自動生成・使用される
exec node dist/index.js
