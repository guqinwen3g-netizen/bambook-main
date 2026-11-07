#!/usr/bin/env bash
# 桌面端热更新预览：Electron 窗口加载本机 Mist 开发服务（3001，业务数据是本机模拟数据），改前端源码即时刷新。
# 与已安装的 Bambook 互不影响（独立名称与用户数据目录）。
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3001
if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "启动本机 Mist 开发服务（端口 $PORT）…"
  npm run dev:mist >/tmp/bambook-mist-dev.log 2>&1 &
  for _ in $(seq 1 60); do lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 1; done
fi
npm run electron:build
BAMBOOK_DEV_PREVIEW=1 ELECTRON_RENDERER_URL="http://localhost:$PORT" exec env -u ELECTRON_RUN_AS_NODE npx electron .
