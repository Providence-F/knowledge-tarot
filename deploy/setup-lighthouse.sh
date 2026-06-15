#!/usr/bin/env bash
# deploy/setup-lighthouse.sh
# Knowledge Tarot 一键部署脚本（腾讯云 Lighthouse Ubuntu 22.04）
#
# 用法（在服务器上执行，需要 sudo / root）：
#   curl -fsSL https://raw.githubusercontent.com/Providence-F/knowledge-tarot/main/deploy/setup-lighthouse.sh | sudo bash
# 或：
#   git clone https://github.com/Providence-F/knowledge-tarot.git /opt/knowledge-tarot
#   cd /opt/knowledge-tarot && sudo bash deploy/setup-lighthouse.sh
#
# 执行完后还需要手动：
#   1. 编辑 /opt/knowledge-tarot/.env 填入 DEEPSEEK_API_KEY
#   2. 跑 sudo -u kt pm2 restart knowledge-tarot

set -euo pipefail

APP_USER="kt"
APP_DIR="/opt/knowledge-tarot"
REPO_URL="https://github.com/Providence-F/knowledge-tarot.git"
NODE_MAJOR="20"   # Node 20 LTS（>=18 即可，20 更稳）

log() { echo -e "\033[1;32m[setup]\033[0m $*"; }
err() { echo -e "\033[1;31m[error]\033[0m $*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "请用 sudo 或 root 执行：sudo bash $0"
  exit 1
fi

# ── 0. 基础工具 + 时区 ─────────────────────────────────────
log "更新 apt + 安装基础包"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ufw nginx

timedatectl set-timezone Asia/Shanghai || true

# ── 1. 创建专用用户（不用 root 跑 node）────────────────────
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "创建用户 $APP_USER"
  useradd -m -s /bin/bash "$APP_USER"
fi

# ── 2. 装 Node ────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  log "安装 Node.js $NODE_MAJOR"
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y -qq nodejs
fi
log "Node 版本：$(node -v) / npm $(npm -v)"

# ── 3. 装 pm2 ─────────────────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  log "安装 pm2"
  npm install -g pm2
fi

# ── 4. 拉代码 ─────────────────────────────────────────────
if [[ ! -d "$APP_DIR/.git" ]]; then
  log "克隆代码到 $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
else
  log "代码已存在，git pull 更新"
  cd "$APP_DIR" && git fetch origin main && git reset --hard origin/main
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 5. 装依赖 ─────────────────────────────────────────────
log "npm install --omit=dev"
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm ci --omit=dev || npm install --omit=dev"

# ── 6. 准备数据目录 + .env ────────────────────────────────
DATA_DIR="$APP_DIR/data"
mkdir -p "$DATA_DIR/users"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"

ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "生成 .env 模板（需要你手动填 DEEPSEEK_API_KEY）"
  cat > "$ENV_FILE" <<EOF
# Knowledge Tarot 生产环境配置
NODE_ENV=production
PORT=3456
DEEPSEEK_API_KEY=请把你的-DEEPSEEK-API-KEY-粘贴到这里
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# ── 7. pm2 启动 ───────────────────────────────────────────
log "用 pm2 启动应用"
sudo -u "$APP_USER" bash -c "cd $APP_DIR && pm2 start deploy/ecosystem.config.cjs && pm2 save"

# 开机自启（pm2 startup 会输出一条命令需要 root 跑）
PM2_STARTUP_CMD=$(sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp /home/"$APP_USER" | tail -n 1 || true)
if [[ -n "$PM2_STARTUP_CMD" && "$PM2_STARTUP_CMD" == sudo* ]]; then
  log "执行 pm2 开机自启注册"
  eval "${PM2_STARTUP_CMD#sudo }"
fi

# ── 8. nginx 反代 80 → 3456 ───────────────────────────────
log "配置 nginx 反向代理"
NGINX_CONF="/etc/nginx/sites-available/knowledge-tarot"
cp "$APP_DIR/deploy/knowledge-tarot.nginx.conf" "$NGINX_CONF"
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/knowledge-tarot
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ── 9. 防火墙 ─────────────────────────────────────────────
log "开 22 / 8080 / 80 / 443 端口"
ufw allow 22/tcp || true
ufw allow 8080/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
yes | ufw enable || true

# ── 10. 完成 ──────────────────────────────────────────────
PUBLIC_IP=$(curl -fsSL --max-time 3 https://api.ipify.org || echo "<你的服务器IP>")
cat <<EOF

\033[1;32m✓ 部署完成\033[0m

下一步必须做：
  1. 编辑 .env 填入 DEEPSEEK_API_KEY：
     sudo nano $ENV_FILE
  2. 重启服务：
     sudo -u $APP_USER pm2 restart knowledge-tarot
  3. 浏览器访问（注意带 :8080 端口号）：
     http://$PUBLIC_IP:8080

  ⚠️ 国内地域(沪/京/穗)使用 8080 端口绕过 ICP 备案要求。
     如果以后绑域名+HTTPS，需要先做 ICP 备案才能用 80/443。

  ⚠️ 腾讯云控制台还要单独开放 8080 端口！
     轻量服务器 → 实例 → 防火墙 → 添加规则 →
     应用类型「自定义」TCP 8080 全部 IP 允许

常用命令：
  pm2 logs knowledge-tarot       # 看日志
  pm2 restart knowledge-tarot    # 重启
  pm2 monit                      # 监控
  cd $APP_DIR && git pull && pm2 restart knowledge-tarot   # 更新代码

EOF
