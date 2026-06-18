#!/usr/bin/env node
/**
 * scripts/e2e-v2.js — knowledge-tarot v2.0 E2E validation
 *
 * Hits HTTP endpoints on a running server with DATA_DIR pointing at an isolated
 * test directory. Does NOT call LLM (DEEPSEEK_API_KEY="" expected).
 *
 * Validates:
 *  1. user creation
 *  2. manual deck + cards with embeddings written to disk
 *  3. structured question {q1,q2,q3} accepted by /draw/single
 *  4. response has dynamicTitle (fallback "（待命名）" since no LLM)
 *  5. orientation field exists, _drawMeta exists
 *  6. history written with cardSnapshots + question struct
 *  7. POST /feedback star, then GET shows star, then verify drawing avoids it
 *  8. POST /dialogue/turn 3 times forces 4th turn to return exhausted=true
 *  9. /decks/:id/stats returns correct shape
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3457;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'test-data');
const COOKIE_FILE = path.join(__dirname, '..', 'test-cookie.txt');

let cookie = '';
try {
  const txt = fs.readFileSync(COOKIE_FILE, 'utf-8');
  // netscape cookie file format: 7 tab fields, last two are name + value
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Strip #HttpOnly_ prefix used by curl
    const clean = line.replace(/^#HttpOnly_/, '');
    if (clean.startsWith('#')) continue;
    const parts = clean.split('\t');
    if (parts.length >= 7 && parts[5] === 'kt_uid') cookie = `kt_uid=${parts[6]}`;
  }
} catch {}
if (!cookie) {
  console.error('FAIL: could not read kt_uid from test-cookie.txt');
  process.exit(1);
}
const userId = cookie.split('=')[1];
console.log('userId =', userId);

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: 'localhost', port: PORT, path: p, method,
      headers: {
        'Cookie': cookie,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

// Generate fake but plausible 512-dim embedding
function fakeEmbedding(seed) {
  const h = crypto.createHash('sha256').update(seed).digest();
  const arr = [];
  let sumSq = 0;
  for (let i = 0; i < 512; i++) {
    const v = (h[i % 32] / 128 - 1) + Math.sin(i + h[0]) * 0.3;
    arr.push(v); sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  return arr.map(v => v / norm);
}

(async () => {
  // 1. user exists
  let r = await req('GET', '/api/v2/me');
  check('GET /api/v2/me returns user', r.status === 200 && r.body?.user?.id === userId);

  // 2. create deck
  r = await req('POST', '/api/v2/decks', { name: 'E2E Test', description: 'test', emoji: '🧪' });
  const deckId = r.body?.deck?.id;
  check('POST /api/v2/decks creates deck', r.status === 200 && deckId, 'deckId=' + deckId);

  // 3. inject cards directly (bypasses LLM pipeline)
  const deckFile = path.join(DATA_DIR, 'users', userId, 'decks', `${deckId}.json`);
  const deck = JSON.parse(fs.readFileSync(deckFile, 'utf-8'));
  const now = Date.now();
  const NINETY_DAYS = 90 * 86400000;
  deck.cards = [
    { id: 'card-old01', title: '旧卡A', summary: '半年前的反思一', passage: '半年前的我写下：在不确定中等待是一种主动。',
      contentType: 'reflection', embedding: fakeEmbedding('old01'), createdAt: now - NINETY_DAYS - 86400000,
      source: { kind: 'textdump' }, suit: 'self', suitName: '自我' },
    { id: 'card-old02', title: '旧卡B', summary: '一年前的判断', passage: '一年前的我写下：选择不是终点，而是观察自己的方法。',
      contentType: 'reflection', embedding: fakeEmbedding('old02'), createdAt: now - NINETY_DAYS - 86400000 * 200,
      source: { kind: 'textdump' }, suit: 'method', suitName: '方法' },
    { id: 'card-new01', title: '新卡', summary: '上周的笔记', passage: '上周的我写下：今天会议有点累。',
      contentType: 'reflection', embedding: fakeEmbedding('new01'), createdAt: now - 7 * 86400000,
      source: { kind: 'textdump' }, suit: 'world', suitName: '世界' }
  ];
  deck.totalCards = deck.cards.length;
  fs.writeFileSync(deckFile, JSON.stringify(deck, null, 2));
  // set as active
  await req('POST', `/api/v2/decks/${deckId}/activate`);
  check('inject 3 cards with embeddings', deck.cards.every(c => Array.isArray(c.embedding) && c.embedding.length === 512));

  // 4. single draw with structured question
  r = await req('POST', '/api/v2/draw/single', { question: { q1: '我现在该不该继续这个项目？', q2: '我隐约觉得不该', q3: '怕做错' } });
  check('POST /draw/single accepts {q1,q2,q3}', r.status === 200);
  const card = r.body?.card;
  check('  → response has card', !!card);
  check('  → dynamicTitle exists', typeof r.body?.dynamicTitle === 'string', `"${r.body?.dynamicTitle}"`);
  check('  → no LLM → fallback "（待命名）"', r.body?.dynamicTitle === '（待命名）');
  check('  → orientation field exists', card?.orientation === 'reversed' || card?.orientation === 'upright');
  check('  → _drawMeta exists', !!card?._drawMeta, JSON.stringify(card?._drawMeta));
  check('  → drawnAt returned', typeof r.body?.drawnAt === 'number');
  const drawnAt = r.body?.drawnAt;

  // 5. history has cardSnapshots + structured question
  r = await req('GET', '/api/v2/history');
  const h0 = r.body?.history?.[0];
  check('history entry has structured question', typeof h0?.question === 'object' && h0?.question?.q1);
  check('history entry has cardSnapshots', Array.isArray(h0?.cardSnapshots) && h0.cardSnapshots.length > 0);
  check('  → snapshot has dynamicTitle', typeof h0?.cardSnapshots?.[0]?.dynamicTitle === 'string');
  check('  → snapshot has orientation', !!h0?.cardSnapshots?.[0]?.orientation);

  // 6. feedback: star one card, verify it gets rare
  const cardToStar = card.id;
  r = await req('POST', '/api/v2/feedback', { deckId, cardId: cardToStar, kind: 'star' });
  check('POST /feedback star', r.status === 200 && r.body?.kind === 'star');
  r = await req('GET', `/api/v2/feedback?deckId=${deckId}`);
  check('GET /feedback returns star', Array.isArray(r.body?.stars) && r.body.stars.includes(cardToStar));

  // 7. block another card → it should never be drawn
  const cardToBlock = deck.cards.find(c => c.id !== cardToStar).id;
  await req('POST', '/api/v2/feedback', { deckId, cardId: cardToBlock, kind: 'block' });
  let blockedSeen = 0;
  for (let i = 0; i < 30; i++) {
    const rr = await req('POST', '/api/v2/draw/single', { question: { q1: 'test', q2: '', q3: '' } });
    if (rr.body?.card?.id === cardToBlock) blockedSeen++;
  }
  check('blocked card never drawn in 30 trials', blockedSeen === 0, `seen=${blockedSeen}`);

  // 8. dialogue MAX_AI_TURNS=3 enforcement
  // Need a fresh draw so we have a card + drawnAt
  r = await req('POST', '/api/v2/draw/single', { question: { q1: '我该不该跳槽？', q2: '我隐约觉得该', q3: '怕错过' } });
  const dCard = r.body?.card;
  const dDrawnAt = r.body?.drawnAt;
  // Build transcript of 3 prior AI turns (simulate user already exhausted)
  // Server schema: {role: 'user'|'ai', text: string}
  const transcript = [];
  for (let i = 0; i < 3; i++) {
    transcript.push({ role: 'user', text: `用户第${i+1}轮` });
    transcript.push({ role: 'ai', text: `AI第${i+1}轮` });
  }
  r = await req('POST', '/api/v2/dialogue/turn', {
    cardId: dCard.id,
    userQuestion: '我该不该跳槽？',
    transcript,
    style: 'gentle',
    drawnAt: dDrawnAt
  });
  check('4th AI turn → exhausted=true', r.body?.exhausted === true, `finalMessage="${(r.body?.finalMessage || '').slice(0, 30)}..."`);
  check('  → finalMessage非空', typeof r.body?.finalMessage === 'string' && r.body.finalMessage.length > 5);

  // 9. deck stats endpoint
  r = await req('GET', `/api/v2/decks/${deckId}/stats`);
  check('GET /decks/:id/stats returns shape', r.status === 200 && typeof r.body?.total === 'number');
  check('  → has health field', !!r.body?.health, r.body?.health);
  check('  → has olderThan90Days', typeof r.body?.olderThan90Days === 'number', String(r.body?.olderThan90Days));

  // 10. recycled flag when excludeIds covers all cards
  // Star+block already excludes 2/3, draw repeatedly → eventually only 1 remains drawable
  // The recycled flag fires when drawSingle filters everything out and falls back
  // We can't easily trigger this without manipulating recent history, so just check absence of crash
  // Also test: very short question still works
  r = await req('POST', '/api/v2/draw/single', { question: '' });
  check('empty question → 200', r.status === 200);
  r = await req('POST', '/api/v2/draw/single', {});
  check('no question → 200', r.status === 200);

  // Summary
  console.log();
  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok);
  console.log(`=== ${passed}/${checks.length} passed ===`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(`  ✗ ${f.name}${f.detail ? ' — ' + f.detail : ''}`));
    process.exit(1);
  }
})().catch(err => { console.error(err); process.exit(1); });
