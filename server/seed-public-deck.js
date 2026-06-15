/**
 * server/seed-public-deck.js
 *
 * 启动时若 DATA_DIR/public-deck.json 不存在，则从镜像内置的 /app/seed-data/ 拷一份过去。
 * 适配场景：HF Spaces / 任何容器平台挂载持久卷盖住了 image 内的 data/。
 *
 * 没有 seed-data 副本时静默跳过——本地 dev 也安全，因为本地有 data/public-deck.json 直接用。
 */
const fs = require('fs');
const path = require('path');

module.exports = function seedPublicDeck() {
  const targetBase = process.env.DATA_DIR
    ? process.env.DATA_DIR
    : path.join(__dirname, '..', 'data');
  const targetFile = path.join(targetBase, 'public-deck.json');

  if (fs.existsSync(targetFile)) {
    // 已存在，不覆盖
    return;
  }

  // 候选 seed 源：Dockerfile 里 cp 到 /app/seed-data/，dev 时也可能在 data/ 本身
  const candidates = [
    path.join(__dirname, '..', 'seed-data', 'public-deck.json'),
    path.join('/app/seed-data/public-deck.json'),
    path.join(__dirname, '..', 'data', 'public-deck.json')
  ];

  for (const src of candidates) {
    try {
      if (fs.existsSync(src) && src !== targetFile) {
        fs.mkdirSync(targetBase, { recursive: true });
        fs.copyFileSync(src, targetFile);
        console.log(`[seed] public-deck.json: ${src} → ${targetFile}`);
        return;
      }
    } catch (e) {
      console.warn(`[seed] failed ${src}: ${e.message}`);
    }
  }
  console.warn('[seed] no public-deck.json source found, public mode will be unavailable');
};
