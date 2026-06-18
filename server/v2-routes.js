/**
 * server/v2-routes.js — Knowledge Tarot v2 路由（多 deck + 分享）
 *
 * v1.1 关键变化：
 *   - GET    /api/v2/decks                         列出 owned + seed 元数据
 *   - POST   /api/v2/decks                         创建空 deck
 *   - PATCH  /api/v2/decks/:deckId                 重命名 / 改 emoji / 改描述
 *   - DELETE /api/v2/decks/:deckId                 删除
 *   - POST   /api/v2/decks/:deckId/activate        设为当前 active
 *   - POST   /api/v2/decks/:deckId/share           生成分享 token
 *   - GET    /api/v2/share/:token                  预览（不消费）
 *   - POST   /api/v2/share/:token/clone            克隆到当前用户
 *   - POST   /api/v2/seed-decks/:seedId/clone      克隆示范牌堆
 *   - GET    /api/v2/seed-decks                    列出示范牌堆
 *   - import/draw/dialogue 全部接受可选 deckId
 *
 * 兼容：保留旧路径 /api/v2/deck（active deck 别名）和 mode 字段
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const storage = require('../src/storage');
const publicDeck = require('../src/public-deck');
const seedDecks = require('../src/seed-decks');
const { processItems } = require('../src/pipeline-v2');
const textdump = require('../src/adapters/textdump');
const chatgpt = require('../src/adapters/chatgpt');
const deepseek = require('../src/adapters/deepseek');
const drawEngine = require('../src/draw-engine');
const ai = require('../src/ai-questioner');
const embedder = require('../src/embedder');

// 把 question 安静地编码成向量，失败时返回 null（draw-engine 自动降级纯随机）
async function embedQuestionSafely(question) {
  if (!question || !question.trim()) return null;
  try {
    return await embedder.embed(question.trim().slice(0, 500));
  } catch (e) {
    console.error('[draw] embed question failed, falling back to random:', e.message);
    return null;
  }
}

const router = express.Router();
router.use(cookieParser());

const SYSTEM_DEFAULT_ID = 'system-default';

function isSecureRequest(req) {
  if (req.secure) return true;
  const xfp = req.headers['x-forwarded-proto'];
  if (typeof xfp === 'string' && xfp.split(',')[0].trim() === 'https') return true;
  return false;
}

router.use((req, res, next) => {
  let uid = req.cookies?.kt_uid;
  if (!uid || !/^[a-f0-9]{32}$/.test(uid)) {
    uid = storage.newUserId();
    res.cookie('kt_uid', uid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureRequest(req),
      maxAge: 365 * 86400000
    });
  }
  req.userId = uid;
  storage.getOrCreateUser(uid);
  next();
});

// ── deck 解析：把任意 deckId（owned/system-default/seed-*）解析成 { meta, cards, isReadOnly, kind }
function resolveDeck(userId, deckId) {
  if (!deckId) {
    const profile = storage.getOrCreateUser(userId);
    deckId = profile.activeDeckId || SYSTEM_DEFAULT_ID;
  }
  if (deckId === SYSTEM_DEFAULT_ID) {
    if (!publicDeck.isReady()) return null;
    const meta = publicDeck.getMeta();
    return {
      kind: 'system-default',
      isReadOnly: true,
      deckId,
      meta: {
        id: SYSTEM_DEFAULT_ID,
        name: meta.name || '系统兜底牌堆',
        description: meta.description || '',
        emoji: '🌌',
        totalCards: meta.totalCards || 0,
        ownerId: 'system'
      },
      cards: publicDeck.getCards()
    };
  }
  if (seedDecks.isSeedId(deckId)) {
    const d = seedDecks.getSeedDeck(deckId);
    if (!d) return null;
    return {
      kind: 'seed',
      isReadOnly: true,
      deckId,
      meta: {
        id: d.id,
        name: d.name,
        description: d.description,
        emoji: d.emoji,
        totalCards: d.cards?.length || 0,
        ownerId: 'system'
      },
      cards: d.cards || []
    };
  }
  if (!storage.isValidDeckId(deckId)) return null;
  const d = storage.getDeck(userId, deckId);
  if (!d || !d.id) return null;
  if (d.ownerId !== userId) return null; // 防越权
  return {
    kind: 'owned',
    isReadOnly: false,
    deckId,
    meta: {
      id: d.id,
      name: d.name,
      description: d.description,
      emoji: d.emoji,
      totalCards: d.cards?.length || 0,
      ownerId: d.ownerId,
      visibility: d.visibility,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      lastImport: d.lastImport
    },
    cards: d.cards || []
  };
}

// 从首行/文件名智能预填 deck name
function smartGuessName(opts = {}) {
  const { firstFilename, text } = opts;
  if (firstFilename) {
    const base = path.basename(firstFilename, path.extname(firstFilename));
    return base.slice(0, 30);
  }
  if (text) {
    const firstLine = text.split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0);
    if (firstLine) return firstLine.slice(0, 30);
  }
  return '未命名牌堆';
}

// ── /api/v2/me ───────────────────────────────────────────
router.get('/me', (req, res) => {
  const profile = storage.getOrCreateUser(req.userId);
  const decks = storage.listDecks(req.userId);
  const active = resolveDeck(req.userId, profile.activeDeckId);
  res.json({
    user: profile,
    userId: req.userId,
    userIdShort: req.userId.slice(0, 8),
    activeDeck: active ? active.meta : null,
    activeDeckKind: active ? active.kind : null,
    decks,
    seedDecks: seedDecks.listSeedDecks(),
    publicDeck: publicDeck.isReady() ? {
      available: true,
      ...publicDeck.getMeta()
    } : { available: false }
  });
});

router.post('/me/style', express.json(), (req, res) => {
  const allowed = ['gentle', 'sharp', 'philosophical', 'playful'];
  const style = req.body?.style;
  if (!allowed.includes(style)) return res.status(400).json({ error: 'Invalid style' });
  const profile = storage.updateUser(req.userId, { style });
  res.json({ user: profile });
});

router.post('/me/mode', express.json(), (req, res) => {
  const mode = req.body?.mode;
  if (!['public', 'private'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "public" or "private"' });
  }
  const patch = { mode, onboardedAt: Date.now() };
  if (mode === 'public') {
    patch.activeDeckId = SYSTEM_DEFAULT_ID;
  }
  const profile = storage.updateUser(req.userId, patch);
  res.json({ user: profile });
});

// ── Decks CRUD ──────────────────────────────────────────
router.get('/decks', (req, res) => {
  const profile = storage.getOrCreateUser(req.userId);
  const effectiveActiveDeckId = profile.activeDeckId || (publicDeck.isReady() ? SYSTEM_DEFAULT_ID : null);
  const owned = storage.listDecks(req.userId).map(d => ({
    ...d,
    isActive: d.id === effectiveActiveDeckId
  }));
  const seeds = seedDecks.listSeedDecks().map(s => ({
    ...s,
    isSeed: true,
    isActive: effectiveActiveDeckId === s.id
  }));
  const sysDefault = publicDeck.isReady() ? [{
    id: SYSTEM_DEFAULT_ID,
    name: publicDeck.getMeta().name || '系统兜底牌堆',
    description: publicDeck.getMeta().description || '',
    emoji: '🌌',
    totalCards: publicDeck.getMeta().totalCards || 0,
    isSystem: true,
    isActive: effectiveActiveDeckId === SYSTEM_DEFAULT_ID
  }] : [];
  res.json({
    owned,
    seeds,
    system: sysDefault,
    activeDeckId: effectiveActiveDeckId
  });
});

router.post('/decks', express.json(), (req, res) => {
  const { name, description = '', emoji = '📚' } = req.body || {};
  const deck = storage.createDeck(req.userId, {
    name: name || '未命名牌堆',
    description,
    emoji
  });
  res.json({ ok: true, deck: { id: deck.id, name: deck.name, emoji: deck.emoji, description: deck.description } });
});

router.patch('/decks/:deckId', express.json(), (req, res) => {
  const { deckId } = req.params;
  const r = resolveDeck(req.userId, deckId);
  if (!r) return res.status(404).json({ error: 'Deck not found' });
  if (r.isReadOnly) return res.status(403).json({ error: '系统/示范牌堆不可修改，请先克隆为副本' });
  const updated = storage.renameDeck(req.userId, deckId, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Deck not found' });
  res.json({ ok: true, deck: { id: updated.id, name: updated.name, emoji: updated.emoji, description: updated.description } });
});

router.delete('/decks/:deckId', (req, res) => {
  const { deckId } = req.params;
  const r = resolveDeck(req.userId, deckId);
  if (!r) return res.status(404).json({ error: 'Deck not found' });
  if (r.isReadOnly) return res.status(403).json({ error: '系统/示范牌堆不可删除' });
  res.json(storage.removeDeck(req.userId, deckId));
});

router.post('/decks/:deckId/activate', (req, res) => {
  const { deckId } = req.params;
  const r = resolveDeck(req.userId, deckId);
  if (!r) return res.status(404).json({ error: 'Deck not found' });
  storage.setActiveDeck(req.userId, deckId);
  res.json({ ok: true, activeDeckId: deckId, deck: r.meta });
});

// ── Seed decks ──────────────────────────────────────────
router.get('/seed-decks', (req, res) => {
  res.json({ seeds: seedDecks.listSeedDecks() });
});

router.post('/seed-decks/:seedId/clone', express.json(), (req, res) => {
  const seed = seedDecks.getSeedDeck(req.params.seedId);
  if (!seed) return res.status(404).json({ error: 'Seed deck not found' });
  const cloned = storage.cloneDeck(seed, req.userId, req.body || {});
  res.json({ ok: true, deckId: cloned.id, deck: { id: cloned.id, name: cloned.name, emoji: cloned.emoji, totalCards: cloned.totalCards } });
});

// ── Share ───────────────────────────────────────────────
router.post('/decks/:deckId/share', express.json(), (req, res) => {
  const { deckId } = req.params;
  const r = resolveDeck(req.userId, deckId);
  if (!r) return res.status(404).json({ error: 'Deck not found' });
  if (r.kind !== 'owned') return res.status(403).json({ error: '只能分享自己的牌堆，系统牌堆请直接复制链接' });
  const expiresInDays = Math.min(Math.max(parseInt(req.body?.expiresInDays || 30, 10), 1), 365);
  const token = storage.createShareToken(req.userId, deckId, expiresInDays);
  res.json({ ok: true, token, shareUrl: `/share/${token}`, expiresInDays });
});

router.get('/share/:token', (req, res) => {
  const t = storage.getShareToken(req.params.token);
  if (!t) return res.status(404).json({ error: 'Token 无效或已过期' });
  const src = storage.getDeck(t.srcUserId, t.srcDeckId);
  if (!src) return res.status(404).json({ error: '源牌堆已被删除' });
  res.json({
    ok: true,
    preview: {
      name: src.name,
      description: src.description,
      emoji: src.emoji,
      totalCards: src.cards?.length || 0,
      ownerIdShort: t.srcUserId.slice(0, 8),
      createdAt: src.createdAt
    },
    expiresAt: t.expiresAt
  });
});

router.post('/share/:token/clone', express.json(), (req, res) => {
  const t = storage.getShareToken(req.params.token);
  if (!t) return res.status(404).json({ error: 'Token 无效或已过期' });
  const src = storage.getDeck(t.srcUserId, t.srcDeckId);
  if (!src) return res.status(404).json({ error: '源牌堆已被删除' });
  const cloned = storage.cloneDeck(src, req.userId, { name: src.name, ...(req.body || {}) });
  res.json({ ok: true, deckId: cloned.id, deck: { id: cloned.id, name: cloned.name, emoji: cloned.emoji, totalCards: cloned.totalCards } });
});

// ── Import ──────────────────────────────────────────────
router.post('/import/text', express.json({ limit: '10mb' }), async (req, res) => {
  const text = req.body?.text;
  const label = req.body?.label || 'pasted';
  let deckId = req.body?.deckId;
  const deckMeta = req.body?.deckMeta || {};
  if (!text || typeof text !== 'string' || text.trim().length < 30) {
    return res.status(400).json({ error: 'Text too short (min 30 chars)' });
  }
  try {
    // 没传 deckId -> 创建新 deck（智能命名）
    if (!deckId) {
      const guessedName = deckMeta.name || smartGuessName({ text });
      const deck = storage.createDeck(req.userId, {
        name: guessedName,
        description: deckMeta.description || '',
        emoji: deckMeta.emoji || '📚'
      });
      deckId = deck.id;
    } else {
      const r = resolveDeck(req.userId, deckId);
      if (!r) return res.status(404).json({ error: 'Deck not found' });
      if (r.isReadOnly) return res.status(403).json({ error: '示范/系统牌堆不可写入，请先克隆' });
    }
    const items = textdump.loadFromText(text, label);
    const { cards, stats } = await processItems(items);
    const result = storage.appendCards(req.userId, deckId, cards, {
      source: 'paste', at: Date.now(), stats
    });
    res.json({ ok: true, deckId, ...result, stats });
  } catch (e) {
    console.error('[import/text] error:', e);
    res.status(500).json({ error: e.message });
  }
});

const MAX_TOTAL_UPLOAD = 100 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 50 }
});

router.post('/import/files', upload.array('files', 50), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0);
  if (totalBytes > MAX_TOTAL_UPLOAD) {
    return res.status(413).json({ error: `所有文件总大小超出 ${MAX_TOTAL_UPLOAD / 1024 / 1024}MB 限制` });
  }
  let deckId = req.body?.deckId;
  const deckMeta = (() => {
    try { return req.body?.deckMeta ? JSON.parse(req.body.deckMeta) : {}; }
    catch { return {}; }
  })();

  try {
    const items = [];
    for (const f of files) {
      const text = f.buffer.toString('utf-8');
      if (!text.trim()) continue;
      if (f.originalname.toLowerCase().endsWith('.json')) {
        const looksDeepSeek = text.includes('"fragments"') && text.includes('"REQUEST"');
        const looksChatGPT = text.includes('"mapping"') && (text.includes('"author"') || text.includes('"parts"'));
        if (looksDeepSeek) {
          try { items.push(...deepseek.loadFromJSON(text)); continue; }
          catch (e) { console.warn(`[import] DeepSeek parse failed for ${f.originalname}:`, e.message); }
        } else if (looksChatGPT) {
          try { items.push(...chatgpt.loadFromJSON(text)); continue; }
          catch (e) { console.warn(`[import] ChatGPT parse failed for ${f.originalname}:`, e.message); }
        }
      }
      if (/\.(md|txt)$/i.test(f.originalname)) {
        items.push({
          id: 'upload-' + f.originalname + '-' + Date.now(),
          body: text,
          title: path.basename(f.originalname, path.extname(f.originalname)),
          createdAt: Date.now(),
          sourceMeta: { type: 'textdump', path: f.originalname }
        });
      }
    }
    if (items.length === 0) return res.status(400).json({ error: 'No valid .md/.txt/conversations.json files' });

    if (!deckId) {
      const guessedName = deckMeta.name || smartGuessName({ firstFilename: files[0].originalname }) +
        (files.length > 1 ? `（及 ${files.length - 1} 个文件）` : '');
      const deck = storage.createDeck(req.userId, {
        name: guessedName,
        description: deckMeta.description || '',
        emoji: deckMeta.emoji || '📚'
      });
      deckId = deck.id;
    } else {
      const r = resolveDeck(req.userId, deckId);
      if (!r) return res.status(404).json({ error: 'Deck not found' });
      if (r.isReadOnly) return res.status(403).json({ error: '示范/系统牌堆不可写入，请先克隆' });
    }

    const { cards, stats } = await processItems(items);
    const result = storage.appendCards(req.userId, deckId, cards, {
      source: 'upload', at: Date.now(),
      filenames: files.map(f => f.originalname),
      stats
    });
    res.json({ ok: true, deckId, ...result, stats });
  } catch (e) {
    console.error('[import/files] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Deck list / cards ───────────────────────────────────
// 兼容旧路径 /api/v2/deck（active deck 别名）
router.get('/deck', (req, res) => {
  const mode = req.query.mode === 'public' ? 'public' : null;
  let deckId = req.query.deckId || null;
  if (mode === 'public') deckId = SYSTEM_DEFAULT_ID;
  const r = resolveDeck(req.userId, deckId);
  if (!r) return res.json({ meta: null, cards: [], total: 0 });
  const lite = (r.cards || []).map(c => ({
    id: c.id, title: c.title, suit: c.suit, suitName: c.suitName,
    contentType: c.contentType, createdAt: c.createdAt
  }));
  res.json({
    meta: r.meta,
    cards: lite,
    total: lite.length,
    isPublic: r.kind === 'system-default',
    isSeed: r.kind === 'seed',
    isReadOnly: r.isReadOnly,
    deckId: r.deckId,
    kind: r.kind
  });
});

router.get('/decks/:deckId/cards', (req, res) => {
  const r = resolveDeck(req.userId, req.params.deckId);
  if (!r) return res.status(404).json({ error: 'Deck not found' });
  const lite = (r.cards || []).map(c => ({
    id: c.id, title: c.title, suit: c.suit, suitName: c.suitName,
    contentType: c.contentType, createdAt: c.createdAt
  }));
  res.json({ meta: r.meta, cards: lite, total: lite.length, isReadOnly: r.isReadOnly, kind: r.kind });
});

router.get('/deck/card/:id', (req, res) => {
  const deckId = req.query.deckId || null;
  const r = resolveDeck(req.userId, deckId);
  if (!r) return res.status(404).json({ error: 'Card not found' });
  let card = (r.cards || []).find(c => c.id === req.params.id);
  // 兜底：在所有可见牌堆里找（owned + system + seeds）
  if (!card) {
    card = publicDeck.getCardById(req.params.id);
    if (!card) {
      for (const s of seedDecks.listSeedDecks()) {
        card = seedDecks.getSeedCard(s.id, req.params.id);
        if (card) break;
      }
    }
  }
  if (!card) return res.status(404).json({ error: 'Card not found' });
  res.json(card);
});

// ── Draw ────────────────────────────────────────────────
function pickPool(userId, deckId) {
  const r = resolveDeck(userId, deckId);
  if (!r) return null;
  return { pool: r.cards || [], kind: r.kind, deckId: r.deckId, isReadOnly: r.isReadOnly };
}

router.post('/draw/single', express.json(), async (req, res) => {
  const question = (req.body?.question || '').trim();
  const deckId = req.body?.deckId || null;
  const profile = storage.getOrCreateUser(req.userId);
  const style = profile.style || 'gentle';
  const picked = pickPool(req.userId, deckId);
  if (!picked) return res.status(404).json({ error: 'Deck not found' });
  if (picked.pool.length === 0) return res.status(400).json({ error: 'Empty deck. Import content first.' });
  const isUntracked = picked.kind !== 'owned';
  const excludeIds = isUntracked ? new Set() : storage.getRecentDrawnIds(req.userId, 7, picked.deckId);
  const questionEmbedding = await embedQuestionSafely(question);
  const card = drawEngine.drawSingle(picked.pool, excludeIds, questionEmbedding);
  if (!card) return res.status(500).json({ error: 'Failed to draw' });
  const [titles, questions] = await Promise.all([
    ai.nameCards([card], question),
    ai.askSingle(card, question, style)
  ]);
  card.title = titles[0] || card.title || '—';
  if (!isUntracked) {
    storage.appendHistory(req.userId, {
      spread: 'single',
      question: question || null,
      cardIds: [card.id],
      deckId: picked.deckId
    });
  }
  res.json({ card, questions, style, isPublic: picked.kind !== 'owned', deckId: picked.deckId, kind: picked.kind });
});

router.post('/draw/three', express.json(), async (req, res) => {
  const question = (req.body?.question || '').trim();
  const deckId = req.body?.deckId || null;
  const profile = storage.getOrCreateUser(req.userId);
  const style = profile.style || 'gentle';
  const picked = pickPool(req.userId, deckId);
  if (!picked) return res.status(404).json({ error: 'Deck not found' });
  if (picked.pool.length < 3) return res.status(400).json({ error: 'Need at least 3 cards in deck.' });
  const isUntracked = picked.kind !== 'owned';
  const excludeIds = isUntracked ? new Set() : storage.getRecentDrawnIds(req.userId, 7, picked.deckId);
  const questionEmbedding = await embedQuestionSafely(question);
  const cards = drawEngine.drawThree(picked.pool, excludeIds, questionEmbedding);
  if (cards.length < 3) return res.status(500).json({ error: 'Failed to draw three' });
  const [titles, narrative] = await Promise.all([
    ai.nameCards(cards, question),
    ai.askThree(cards, question, style)
  ]);
  cards.forEach((c, i) => { c.title = titles[i] || c.title || '—'; });
  if (!isUntracked) {
    storage.appendHistory(req.userId, {
      spread: 'three',
      question: question || null,
      cardIds: cards.map(c => c.id),
      deckId: picked.deckId
    });
  }
  res.json({ cards, narrative, style, isPublic: picked.kind !== 'owned', deckId: picked.deckId, kind: picked.kind });
});

// ── Dialogue ────────────────────────────────────────────
const MAX_TRANSCRIPT_ENTRIES = 50;
const MAX_TRANSCRIPT_TEXT_LEN = 2000;
const MAX_USER_QUESTION_LEN = 500;

function validateTranscript(transcript) {
  if (!Array.isArray(transcript)) return { ok: false, error: 'transcript must be array' };
  if (transcript.length > MAX_TRANSCRIPT_ENTRIES) return { ok: false, error: `transcript too long (max ${MAX_TRANSCRIPT_ENTRIES})` };
  for (const t of transcript) {
    if (!t || typeof t !== 'object') return { ok: false, error: 'invalid transcript entry' };
    if (t.role !== 'user' && t.role !== 'ai') return { ok: false, error: 'role must be "user" or "ai"' };
    if (typeof t.text !== 'string') return { ok: false, error: 'text must be string' };
    if (t.text.length > MAX_TRANSCRIPT_TEXT_LEN) return { ok: false, error: `transcript text too long (max ${MAX_TRANSCRIPT_TEXT_LEN})` };
  }
  return { ok: true };
}

router.post('/dialogue/turn', express.json({ limit: '256kb' }), async (req, res) => {
  const { cardId, cardIds, dialogueId, transcript = [], userQuestion = '', deckId = null } = req.body || {};
  const ids = Array.isArray(cardIds) && cardIds.length > 0 ? cardIds : (cardId ? [cardId] : []);
  if (ids.length === 0) return res.status(400).json({ error: 'cardId or cardIds required' });
  if (ids.length > 5) return res.status(400).json({ error: 'too many cards (max 5)' });
  if (typeof userQuestion !== 'string' || userQuestion.length > MAX_USER_QUESTION_LEN) {
    return res.status(400).json({ error: `userQuestion too long (max ${MAX_USER_QUESTION_LEN})` });
  }
  const v = validateTranscript(transcript);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const profile = storage.getOrCreateUser(req.userId);
  const r = resolveDeck(req.userId, deckId);
  const cards = [];
  for (const id of ids) {
    let c = r ? (r.cards || []).find(x => x.id === id) : null;
    if (!c) c = publicDeck.getCardById(id);
    if (!c) {
      for (const s of seedDecks.listSeedDecks()) {
        c = seedDecks.getSeedCard(s.id, id);
        if (c) break;
      }
    }
    if (!c) return res.status(403).json({ error: 'Card not accessible' });
    cards.push(c);
  }

  const style = profile.style || 'gentle';
  const question = await ai.dialogueTurn(cards, transcript, style, userQuestion);

  let savedId = dialogueId;
  const isUntracked = !r || r.kind !== 'owned';
  if (!isUntracked) {
    const newTranscript = [...(transcript || []), { role: 'ai', text: question }];
    const id = (dialogueId && /^[a-zA-Z0-9_-]+$/.test(dialogueId))
      ? dialogueId
      : crypto.randomBytes(8).toString('hex');
    const saved = storage.saveDialogue(req.userId, {
      id,
      cardIds: ids,
      cardTitles: cards.map(c => c.title || '—'),
      style,
      userQuestion: userQuestion || null,
      transcript: newTranscript,
      deckId: r.deckId,
      createdAt: (storage.getDialogue(req.userId, id)?.createdAt) || Date.now()
    });
    savedId = saved.id;
  }
  res.json({ question, style, dialogueId: savedId || null, isPublic: isUntracked, deckId: r ? r.deckId : null });
});

router.get('/dialogues', (req, res) => {
  res.json({ dialogues: storage.listDialogues(req.userId) });
});
router.get('/dialogues/:id', (req, res) => {
  const d = storage.getDialogue(req.userId, req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json(d);
});
router.delete('/dialogues/:id', (req, res) => {
  res.json(storage.removeDialogue(req.userId, req.params.id));
});

// ── deck 内卡片管理 ─────────────────────────────────────
router.delete('/deck', (req, res) => {
  const deckId = req.query.deckId || null;
  const r = resolveDeck(req.userId, deckId);
  if (!r) return res.status(404).json({ error: 'Deck not found' });
  if (r.isReadOnly) return res.status(403).json({ error: '示范/系统牌堆不可清空' });
  res.json(storage.clearDeck(req.userId, r.deckId));
});

router.delete('/deck/card/:id', (req, res) => {
  const deckId = req.query.deckId || null;
  const r = resolveDeck(req.userId, deckId);
  if (!r) return res.status(404).json({ error: 'Deck not found' });
  if (r.isReadOnly) return res.status(403).json({ error: '示范/系统牌堆不可删除卡片' });
  res.json(storage.removeCard(req.userId, r.deckId, req.params.id));
});

// ── 历史 ────────────────────────────────────────────────
router.delete('/history', (req, res) => {
  res.json(storage.clearHistory(req.userId));
});
router.delete('/history/:drawnAt', (req, res) => {
  const t = parseInt(req.params.drawnAt, 10);
  if (!t) return res.status(400).json({ error: 'Invalid drawnAt' });
  res.json(storage.removeHistoryEntry(req.userId, t));
});

router.get('/history', (req, res) => {
  const deckId = req.query.deckId || null;
  let history = storage.getHistory(req.userId);
  if (deckId) history = history.filter(h => h.deckId === deckId);
  res.json({ history: history.slice(0, 50) });
});

// ── 身份导出 / 导入 ─────────────────────────────────────
router.get('/me/export', (req, res) => {
  res.json({ userId: req.userId });
});
router.post('/me/import', express.json(), (req, res) => {
  const target = (req.body?.userId || '').trim();
  if (!/^[a-f0-9]{32}$/.test(target)) {
    return res.status(400).json({ error: '身份码格式不对（应为 32 位十六进制）' });
  }
  if (!storage.userExists(target)) {
    return res.status(404).json({ error: '没找到这个身份的牌库（可能拼错了或从未在本服务创建）' });
  }
  res.cookie('kt_uid', target, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    maxAge: 365 * 86400000
  });
  res.json({ ok: true, userId: target });
});

module.exports = router;
