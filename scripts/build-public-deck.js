#!/usr/bin/env node
/**
 * scripts/build-public-deck.js — 构建公共示例牌堆
 *
 * 输入：DeepSeek conversations.json（默认从 Temp/deepseek-export 取）
 * 输出：data/public-deck.json，结构：
 *   {
 *     meta: { name, description, builtAt, totalCards, sourceLabel },
 *     cards: Card[]
 *   }
 *
 * 用途：
 *   - 让没有自己内容的访客先用这个 demo deck 试玩
 *   - 服务器读取后挂在内存里，所有 demo 模式用户共享只读
 */

const fs = require('fs');
const path = require('path');
const deepseek = require('../src/adapters/deepseek');
const { processItems } = require('../src/pipeline-v2');

const DEFAULT_INPUT = process.argv[2] ||
  path.join(process.env.LOCALAPPDATA || '', 'Temp', 'deepseek-export', 'conversations.json');

const OUTPUT = path.join(__dirname, '..', 'data', 'public-deck.json');

async function main() {
  if (!fs.existsSync(DEFAULT_INPUT)) {
    console.error(`✗ 输入文件不存在: ${DEFAULT_INPUT}`);
    process.exit(1);
  }
  console.log(`▶ 读取: ${DEFAULT_INPUT}`);
  const text = fs.readFileSync(DEFAULT_INPUT, 'utf-8');
  const items = deepseek.loadFromJSON(text);
  console.log(`✓ 解析出 ${items.length} 条对话`);

  const t0 = Date.now();
  let kept = 0;
  const { cards, stats } = await processItems(items, (p) => {
    if (p.kept) kept++;
    if (p.i % 20 === 0 || p.i === p.total) {
      const pct = ((p.i / p.total) * 100).toFixed(1);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  [${pct}%] ${p.i}/${p.total} · 用时 ${elapsed}s · 已留 ${kept}`);
    }
  }, 8);

  console.log(`\n=== 统计 ===`);
  console.log(`总对话: ${stats.total}`);
  console.log(`保留: ${stats.kept}`);
  console.log(`分诊分布:`, stats.categoryDist);
  console.log(`花色分布:`, stats.suitDist);

  const out = {
    meta: {
      name: '创始人和 DeepSeek 的一年隐私对话',
      description: '已脱敏 / 公开作为示例牌堆 · 你可以抽牌、对话，但无法删卡',
      builtAt: Date.now(),
      totalCards: cards.length,
      sourceLabel: 'DeepSeek conversations · 2025–2026'
    },
    cards
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  const mb = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ 已写入 ${OUTPUT} (${mb} MB)`);
  console.log(`总耗时: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`);
}

main().catch(e => {
  console.error('✗ 构建失败:', e);
  process.exit(1);
});
