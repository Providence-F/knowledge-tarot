# Knowledge Tarot — Hugging Face Spaces (Docker SDK)
FROM node:18-alpine

WORKDIR /app

# 1. 装依赖（缓存友好）
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# 2. 拷代码 + 公共牌堆
COPY . .

# 3. HF Spaces 默认端口 7860
ENV PORT=7860
ENV NODE_ENV=production

# 4. HF 免费 Space 临时盘 / Persistent Storage 都挂在 /data
#    storage.js / public-deck.js 通过 DATA_DIR 读取
ENV DATA_DIR=/data

# 5. 把镜像内的 public-deck.json 缓存到 /app/seed-data 供启动时 seed 用
RUN mkdir -p /app/seed-data && \
    cp -f data/public-deck.json /app/seed-data/public-deck.json 2>/dev/null || \
    echo "[seed] no public-deck.json bundled, skipping"

# 6. /data 写权限（HF Spaces 容器以非 root 用户跑）
RUN mkdir -p /data && chmod -R 777 /data

EXPOSE 7860

CMD ["node", "server/index.js"]
