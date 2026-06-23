#!/usr/bin/env bash
# deploy/update.sh
# Knowledge Tarot 生产环境增量更新脚本
#
# 用法（在服务器上执行，需要 root 或 sudo）：
#   cd /opt/knowledge-tarot
#   sudo bash deploy/update.sh
#
# 功能：
#   - 自动修复目录权限
#   - 优先 git pull，失败则 curl raw 文件回退
#   - 清理僵尸 node 进程，避免 EADDRINUSE
#   - 使用 ecosystem.config.cjs 重启
#   - 健康检查

set -uo pipefail

APP_USER="kt"
APP_DIR="/opt/knowledge-tarot"
PORT=3456
REPO="https://github.com/Providence-F/knowledge-tarot"
BRANCH="main"

log() { echo -e "\033[1;32m[update]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
err() { echo -e "\033[1;31m[error]\033[0m $*" >&2; }

cd "$APP_DIR" || { err "无法进入 $APP_DIR"; exit 1; }

# ── 0. 权限修复 ───────────────────────────────────────────
log "修复目录权限"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 1. git 配置 ───────────────────────────────────────────
sudo -u "$APP_USER" git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

# ── 2. 拉取最新代码 ───────────────────────────────────────
log "尝试 git pull（最多 30 秒）..."
if sudo -u "$APP_USER" bash -c "cd $APP_DIR && timeout 30 git -c http.version=HTTP/1.1 pull origin $BRANCH"; then
  log "git pull 成功"
else
  warn "git pull 失败或超时，使用 curl raw 文件回退"
  sudo -u "$APP_USER" bash -c "
    cd $APP_DIR
    curl -fsSL -o public/css/style.css '$REPO/raw/$BRANCH/public/css/style.css'
    curl -fsSL -o public/js/v2-app.js '$REPO/raw/$BRANCH/public/js/v2-app.js'
    curl -fsSL -o public/v2.html '$REPO/raw/$BRANCH/public/v2.html'
  " || { err "curl 回退也失败"; exit 1; }
fi

# ── 3. 确保日志目录存在 ───────────────────────────────────
mkdir -p /var/log/knowledge-tarot
chown -R "$APP_USER:$APP_USER" /var/log/knowledge-tarot

# ── 4. 清理占端口的僵尸进程 ───────────────────────────────
log "检查端口 $PORT 占用..."
ZOMBIES=$(lsof -i :$PORT -t 2>/dev/null || true)
if [[ -n "$ZOMBIES" ]]; then
  warn "发现占用端口的进程: $ZOMBIES，准备清理"
  kill -9 $ZOMBIES 2>/dev/null || true
  sleep 1
fi

# ── 5. 用 ecosystem.config.cjs 启动 / 重启 ────────────────
log "使用 ecosystem.config.cjs 重启 pm2..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR && pm2 delete knowledge-tarot 2>/dev/null || true"
sudo -u "$APP_USER" bash -c "cd $APP_DIR && pm2 start deploy/ecosystem.config.cjs && pm2 save"

# ── 6. 健康检查 ───────────────────────────────────────────
log "等待服务就绪..."
for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:$PORT/v2.html" >/dev/null 2>&1; then
    log "健康检查通过"
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:$PORT/v2.html" >/dev/null 2>&1; then
  err "健康检查失败"
  sudo -u "$APP_USER" pm2 logs knowledge-tarot --lines 30
  exit 1
fi

# ── 7. 状态输出 ───────────────────────────────────────────
log "当前部署状态："
sudo -u "$APP_USER" pm2 list
LAST_MODIFIED=$(curl -fsS -I "http://127.0.0.1:$PORT/v2.html" | grep -i Last-Modified | awk '{$1=""; print $0}' | sed 's/^ //')
log "v2.html Last-Modified: $LAST_MODIFIED"

log "✓ 更新完成"
