/**
 * scripts/build-seed-decks.js — 把 seeds/*.md 跑过 pipeline-v2 生成 4 个示范牌堆
 *
 * 输入: seeds/{slug}.md  （每条 entry 用 \n---\n 分隔）
 * 输出: data/seed-decks/{slug}.json
 *       data/seed-decks/registry.json
 *
 * 用法:
 *   node scripts/build-seed-decks.js                 # 全部跑
 *   node scripts/build-seed-decks.js --only=jay-lyrics
 *   node scripts/build-seed-decks.js --dry-run       # 只预览不写
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { processItems } = require('../src/pipeline-v2');
const { hashId } = require('../src/utils');

const SEEDS_DIR = path.join(__dirname, '..', 'seeds');
const OUT_DIR = path.join(__dirname, '..', 'data', 'seed-decks');

const ARGS = process.argv.slice(2);
const ONLY = (ARGS.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;
const DRY_RUN = ARGS.includes('--dry-run');

const SEED_DEFS = [
  {
    slug: 'jay-lyrics',
    file: 'jay-lyrics.md',
    name: '周杰伦歌词',
    description: '把华语流行音乐当作一面镜子——稻香、青花瓷、菊花台……每张牌都是一段被歌词触发的人生命题。',
    emoji: '🎵',
    order: 1
  },
  {
    slug: 'harry-potter',
    file: 'harry-potter.md',
    name: '哈利波特金句',
    description: '从 7 部书里抽出的成长母题——选择 vs 能力、镜中欲望、邓布利多的爱、斯内普的双面……',
    emoji: '⚡',
    order: 2
  },
  {
    slug: 'world-decisions',
    file: 'world-decisions.md',
    name: '世界历史重大决策',
    description: '改变历史走向的决策时刻——古巴导弹、马歇尔计划、邓小平南巡、戴高乐伦敦呼吁……当作决策模型抽出来当镜子。',
    emoji: '🏛️',
    order: 3
  },
  {
    slug: 'ai-dialogues',
    file: 'ai-dialogues.md',
    name: 'AI 深度对话',
    description: '人和 AI 真实质感的对话片段——焦虑的成分分析、被讨厌的练习、放弃的资格……',
    emoji: '🤖',
    order: 4
  }
];

function splitEntries(markdown) {
  // 跳过文件最开始的 H1 + 简介（第一个 --- 之前的内容）
  const parts = markdown.split(/\n-{3,}\n/);
  // 第一段是文件头说明，丢掉
  return parts.slice(1).map(s => s.trim()).filter(Boolean);
}

function entryToRawItem(entry, slug, idx) {
  const titleMatch = entry.match(/^#\s*(.+?)(?:\n|$)/);
  const title = titleMatch ? titleMatch[1].trim() : `${slug} #${idx + 1}`;
  const body = entry.replace(/^#\s*.+?\n+/, '').trim();
  return {
    id: hashId('seed', slug, idx, title),
    body,
    title,
    createdAt: Date.now(),
    sourceMeta: { type: 'seed', label: slug, segmentIndex: idx }
  };
}

async function buildOne(def) {
  const filePath = path.join(SEEDS_DIR, def.file);
  if (!fs.existsSync(filePath)) {
    console.error(`  ✗ ${def.slug}: ${def.file} 不存在`);
    return null;
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  const entries = splitEntries(text);
  console.log(`  ${def.slug}: ${entries.length} 条 entry`);
  const items = entries.map((e, i) => entryToRawItem(e, def.slug, i));

  if (DRY_RUN) {
    console.log(`     dry-run; 第一条 title: "${items[0]?.title}"`);
    return null;
  }

  const startTs = Date.now();
  let lastLog = 0;
  let keptCount = 0;
  const { cards, stats } = await processItems(items, (p) => {
    if (p.kept) keptCount += 1;
    const now = Date.now();
    if (now - lastLog > 3000) {
      lastLog = now;
      console.log(`     [${def.slug}] ${p.i}/${p.total} kept=${keptCount}`);
    }
  });
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);

  console.log(`     ✓ ${def.slug}: kept=${cards.length}/${items.length} (${elapsed}s) suits=${JSON.stringify(stats.suitDist)}`);

  if (cards.length === 0) {
    console.warn(`     ⚠ ${def.slug} 0 张卡，跳过写入`);
    return null;
  }

  const now = Date.now();
  const deck = {
    id: `seed-${def.slug}`,
    slug: def.slug,
    ownerId: 'system',
    name: def.name,
    description: def.description,
    emoji: def.emoji,
    visibility: 'system-readonly',
    createdAt: now,
    updatedAt: now,
    totalCards: cards.length,
    lastImport: { source: 'seed-build', at: now, file: def.file },
    cards
  };
  const outFile = path.join(OUT_DIR, `${def.slug}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(deck, null, 2));
  return { def, totalCards: cards.length };
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('缺少 DEEPSEEK_API_KEY，请检查 .env');
    process.exit(1);
  }

  const targets = ONLY
    ? SEED_DEFS.filter(d => d.slug === ONLY)
    : SEED_DEFS;
  if (targets.length === 0) {
    console.error(`无匹配 seed: ${ONLY}`);
    process.exit(1);
  }

  console.log(`[build-seed-decks] mode=${DRY_RUN ? 'dry-run' : 'apply'}, targets=${targets.map(t => t.slug).join(',')}`);

  const results = [];
  for (const def of targets) {
    const r = await buildOne(def);
    if (r) results.push(r);
  }

  if (DRY_RUN) return;

  // 重建 registry.json（合并已有的，不被覆盖的 def 保留）
  const registryPath = path.join(OUT_DIR, 'registry.json');
  const existing = fs.existsSync(registryPath)
    ? JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
    : [];
  const byId = {};
  for (const e of existing) byId[e.id] = e;
  for (const def of SEED_DEFS) {
    const id = `seed-${def.slug}`;
    const file = path.join(OUT_DIR, `${def.slug}.json`);
    if (!fs.existsSync(file)) continue;
    const deck = JSON.parse(fs.readFileSync(file, 'utf-8'));
    byId[id] = {
      id,
      slug: def.slug,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      totalCards: deck.cards?.length || 0,
      order: def.order
    };
  }
  const registry = Object.values(byId).sort((a, b) => (a.order || 99) - (b.order || 99));
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  console.log(`\n✓ 写入 registry.json (${registry.length} decks)`);
  console.log(registry.map(r => `  - ${r.emoji} ${r.name} (${r.totalCards} cards)`).join('\n'));
}

main().catch(e => {
  console.error('Failed:', e);
  process.exit(1);
});
