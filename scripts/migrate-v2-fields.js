/**
 * scripts/migrate-v2-fields.js — v1.1 → v2.0 schema migration
 *
 * 范围：
 *   - data/users/{uid}/decks/*.json  用户私有 deck
 *   - data/seed-decks/*.json         示范 deck（git-tracked）
 *   - data/public-deck.json          公共兜底 deck（git-tracked）
 *
 * 操作（每个 deck）：
 *   1. 顶层加 schemaVersion: 2（如果还没有）
 *   2. 每张 card 加 embedding: null（如果还没有，T05 backfill 会填实值）
 *   3. embedding 后续保留 number[] | null 两态：null 表示未算或失败，draw-engine 必须容忍
 *
 * 不做：
 *   - 不加 orientation 到 card schema：orientation 是 draw-time 随机决定的，
 *     落到 history 记录（见 T18），和 card 本体无关
 *   - 不删任何已有字段：保持兼容
 *   - 不改用户数据语义：纯加字段
 *
 * 幂等：
 *   - 跑第二次什么都不做，schemaVersion=2 直接跳过
 *   - 单独再运行 --force 才会 reset embedding（默认 false）
 *
 * Usage:
 *   node scripts/migrate-v2-fields.js               # 干跑，只统计，不写盘
 *   node scripts/migrate-v2-fields.js --apply       # 实际写盘
 *   node scripts/migrate-v2-fields.js --apply --reset-embeddings   # 强制把 embedding 重置成 null（用于切换模型时）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SCHEMA_VERSION = 2;

const apply = process.argv.includes('--apply');
const resetEmbeddings = process.argv.includes('--reset-embeddings');

const stats = {
  decksScanned: 0,
  decksUpgraded: 0,
  decksAlreadyV2: 0,
  cardsScanned: 0,
  cardsGotEmbeddingField: 0,
  cardsResetEmbedding: 0,
  errors: []
};

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function migrateDeck(deckPath, label) {
  let deck;
  try {
    deck = readJSON(deckPath);
  } catch (e) {
    stats.errors.push(`${label}: read failed: ${e.message}`);
    return;
  }
  stats.decksScanned++;

  let cards = deck.cards;
  if (!Array.isArray(cards)) {
    stats.errors.push(`${label}: no cards[]`);
    return;
  }

  const wasV2 = deck.schemaVersion === SCHEMA_VERSION;
  let touched = false;

  if (!wasV2) {
    deck.schemaVersion = SCHEMA_VERSION;
    touched = true;
  } else {
    stats.decksAlreadyV2++;
  }

  for (const card of cards) {
    stats.cardsScanned++;
    if (!('embedding' in card)) {
      card.embedding = null;
      stats.cardsGotEmbeddingField++;
      touched = true;
    } else if (resetEmbeddings && card.embedding !== null) {
      card.embedding = null;
      stats.cardsResetEmbedding++;
      touched = true;
    }
  }

  if (touched) {
    stats.decksUpgraded++;
    if (apply) writeJSON(deckPath, deck);
  }
}

function migrateUserDecks() {
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return;
  for (const uid of fs.readdirSync(usersDir)) {
    const decksDir = path.join(usersDir, uid, 'decks');
    if (!fs.existsSync(decksDir)) continue;
    for (const f of fs.readdirSync(decksDir)) {
      if (!f.endsWith('.json')) continue;
      migrateDeck(path.join(decksDir, f), `users/${uid}/decks/${f}`);
    }
  }
}

function migrateSeedDecks() {
  const seedDir = path.join(DATA_DIR, 'seed-decks');
  if (!fs.existsSync(seedDir)) return;
  for (const f of fs.readdirSync(seedDir)) {
    if (!f.endsWith('.json') || f === 'registry.json') continue;
    migrateDeck(path.join(seedDir, f), `seed-decks/${f}`);
  }
}

function migratePublicDeck() {
  const p = path.join(DATA_DIR, 'public-deck.json');
  if (fs.existsSync(p)) migrateDeck(p, 'public-deck.json');
}

function main() {
  console.log(`[migrate-v2-fields] mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  if (resetEmbeddings) console.log(`[migrate-v2-fields] --reset-embeddings: existing embeddings will be cleared`);

  migrateUserDecks();
  migrateSeedDecks();
  migratePublicDeck();

  console.log('\n--- stats ---');
  console.log(`decks scanned:           ${stats.decksScanned}`);
  console.log(`decks needed upgrade:    ${stats.decksUpgraded}`);
  console.log(`decks already at v${SCHEMA_VERSION}:      ${stats.decksAlreadyV2}`);
  console.log(`cards scanned:           ${stats.cardsScanned}`);
  console.log(`cards got embedding fld: ${stats.cardsGotEmbeddingField}`);
  console.log(`cards reset embedding:   ${stats.cardsResetEmbedding}`);
  if (stats.errors.length) {
    console.log(`\nerrors (${stats.errors.length}):`);
    for (const e of stats.errors) console.log(`  ${e}`);
  }
  console.log(apply ? '\nDONE (writes applied).' : '\nDRY RUN finished. Re-run with --apply to write.');
}

main();
