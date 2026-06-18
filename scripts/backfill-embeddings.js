/**
 * scripts/backfill-embeddings.js — 给老 card 补算 embedding
 *
 * 范围：
 *   - data/users/{uid}/decks/*.json
 *   - data/seed-decks/*.json
 *   - data/public-deck.json
 *
 * 操作：
 *   - 对每张 card.embedding === null 的卡，用 summary || passage || title 前 500 字
 *     调 embedder.embed() 算 bge-small-zh embedding，写回 card.embedding
 *   - 已经有非 null embedding 的卡跳过（除非 --reset）
 *   - 每处理完一个 deck 立即 save，断电/中断也不丢
 *
 * Usage:
 *   node scripts/backfill-embeddings.js                 # 干跑，统计待处理量
 *   node scripts/backfill-embeddings.js --apply         # 实际算 + 写盘
 *   node scripts/backfill-embeddings.js --apply --reset # 强制重算所有 card 的 embedding
 *   node scripts/backfill-embeddings.js --apply --only-users   # 只处理用户 deck，跳过 seed/public
 */

const fs = require('fs');
const path = require('path');
const embedder = require('../src/embedder');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

const apply = process.argv.includes('--apply');
const reset = process.argv.includes('--reset');
const onlyUsers = process.argv.includes('--only-users');

const stats = {
  decksScanned: 0,
  cardsScanned: 0,
  needsEmbed: 0,
  embedded: 0,
  failed: 0,
  skipped: 0
};

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function writeJSON(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

function embedTextFor(card) {
  const t = (card.summary || card.passage || card.title || '').slice(0, 500);
  return t.trim();
}

async function processDeck(deckPath, label) {
  let deck;
  try { deck = readJSON(deckPath); }
  catch (e) {
    console.error(`[backfill] ${label}: read fail: ${e.message}`);
    return;
  }
  stats.decksScanned++;
  if (!Array.isArray(deck.cards)) return;

  let touched = false;
  let dirty = 0;
  for (const card of deck.cards) {
    stats.cardsScanned++;
    const has = Array.isArray(card.embedding) && card.embedding.length > 0;

    if (has && !reset) {
      stats.skipped++;
      continue;
    }
    const text = embedTextFor(card);
    if (!text) {
      stats.skipped++;
      continue;
    }

    stats.needsEmbed++;
    if (!apply) continue;

    try {
      const vec = await embedder.embed(text);
      card.embedding = vec;
      stats.embedded++;
      touched = true;
      dirty++;
      if (dirty % 50 === 0) {
        // intermediate save — 断电友好
        writeJSON(deckPath, deck);
        process.stdout.write(`  [${label}] saved at ${dirty}/${deck.cards.length}\n`);
      }
    } catch (e) {
      stats.failed++;
      console.error(`[backfill] ${label}/${card.id}: embed fail: ${e.message}`);
    }
  }

  if (touched && apply) writeJSON(deckPath, deck);
  console.log(`[backfill] ${label}: ${dirty}/${deck.cards.length} embedded`);
}

async function processUserDecks() {
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return;
  for (const uid of fs.readdirSync(usersDir)) {
    const decksDir = path.join(usersDir, uid, 'decks');
    if (!fs.existsSync(decksDir)) continue;
    for (const f of fs.readdirSync(decksDir)) {
      if (!f.endsWith('.json')) continue;
      await processDeck(path.join(decksDir, f), `users/${uid.slice(0, 8)}/${f}`);
    }
  }
}

async function processSeedDecks() {
  const seedDir = path.join(DATA_DIR, 'seed-decks');
  if (!fs.existsSync(seedDir)) return;
  for (const f of fs.readdirSync(seedDir)) {
    if (!f.endsWith('.json') || f === 'registry.json') continue;
    await processDeck(path.join(seedDir, f), `seed-decks/${f}`);
  }
}

async function processPublicDeck() {
  const p = path.join(DATA_DIR, 'public-deck.json');
  if (fs.existsSync(p)) await processDeck(p, 'public-deck.json');
}

async function main() {
  console.log(`[backfill] mode: ${apply ? 'APPLY (computing + writing)' : 'DRY RUN'}`);
  if (reset) console.log(`[backfill] --reset: existing embeddings will be recomputed`);
  if (onlyUsers) console.log(`[backfill] --only-users: skipping seed-decks + public-deck`);

  if (apply) {
    console.log('[backfill] starting embedder...');
    await embedder.getEmbedder().start();
    console.log('[backfill] embedder ready');
  }

  const t0 = Date.now();
  await processUserDecks();
  if (!onlyUsers) {
    await processSeedDecks();
    await processPublicDeck();
  }
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n--- stats ---');
  console.log(`decks scanned:  ${stats.decksScanned}`);
  console.log(`cards scanned:  ${stats.cardsScanned}`);
  console.log(`needs embed:    ${stats.needsEmbed}`);
  console.log(`embedded:       ${stats.embedded}`);
  console.log(`skipped:        ${stats.skipped}`);
  console.log(`failed:         ${stats.failed}`);
  console.log(`elapsed:        ${elapsedSec}s`);

  if (apply) await embedder.shutdown();
  console.log(apply ? 'DONE.' : 'DRY RUN finished. Re-run with --apply.');
}

main().catch(e => {
  console.error('[backfill] FATAL:', e);
  process.exit(1);
});
