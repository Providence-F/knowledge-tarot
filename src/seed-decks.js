/**
 * src/seed-decks.js — 系统预装的"示范牌堆"加载器
 *
 * data/seed-decks/registry.json   牌堆元数据列表
 * data/seed-decks/{slug}.json     完整牌堆（结构同用户 deck）
 *
 * 读取后全量缓存到内存，所有用户共享只读。
 * 用户可一键克隆为自己可改的副本（POST /seed-decks/:id/clone）。
 */

const fs = require('fs');
const path = require('path');

const DATA_BASE = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : path.join(__dirname, '..', 'data');
const DIR = path.join(DATA_BASE, 'seed-decks');
const REGISTRY = path.join(DIR, 'registry.json');

let registry = [];
let decksById = {};

function load() {
  registry = [];
  decksById = {};
  if (!fs.existsSync(REGISTRY)) {
    console.warn('[seed-decks] registry.json 不存在，示范牌堆未启用');
    return;
  }
  try {
    const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));
    if (!Array.isArray(reg)) throw new Error('registry must be array');
    for (const entry of reg) {
      const slug = entry.slug;
      const file = path.join(DIR, `${slug}.json`);
      if (!fs.existsSync(file)) {
        console.warn(`[seed-decks] 缺少 ${slug}.json，跳过`);
        continue;
      }
      const deck = JSON.parse(fs.readFileSync(file, 'utf-8'));
      // id 形如 seed-jay-lyrics
      const id = entry.id || `seed-${slug}`;
      const fullDeck = {
        ...deck,
        id,
        ownerId: 'system',
        visibility: 'system-readonly',
        slug,
        name: entry.name || deck.name,
        description: entry.description || deck.description,
        emoji: entry.emoji || deck.emoji
      };
      decksById[id] = fullDeck;
      registry.push({
        id,
        slug,
        name: fullDeck.name,
        description: fullDeck.description,
        emoji: fullDeck.emoji,
        totalCards: fullDeck.cards?.length || 0,
        order: entry.order || 99
      });
    }
    registry.sort((a, b) => (a.order || 0) - (b.order || 0));
    console.log(`[seed-decks] 已加载 ${registry.length} 个示范牌堆`);
  } catch (e) {
    console.error('[seed-decks] 加载失败:', e.message);
    registry = [];
    decksById = {};
  }
}

function isSeedId(deckId) {
  return typeof deckId === 'string' && deckId.startsWith('seed-');
}

function listSeedDecks() {
  return registry.map(r => ({ ...r }));
}

function getSeedDeck(deckId) {
  return decksById[deckId] || null;
}

function getSeedCard(deckId, cardId) {
  const d = decksById[deckId];
  if (!d) return null;
  return (d.cards || []).find(c => c.id === cardId) || null;
}

load();

module.exports = {
  load,
  isSeedId,
  listSeedDecks,
  getSeedDeck,
  getSeedCard
};
