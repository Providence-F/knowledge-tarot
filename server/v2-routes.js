/**
 * server/v2-routes.js — Knowledge Tarot v2 路由（多源接入 + 用户系统）
 *
 * 路由清单：
 *   GET  /api/v2/me                 当前用户（cookie 自动注册）
 *   POST /api/v2/me/style           更新风格偏好
 *   POST /api/v2/import/text        粘贴文本导入
 *   POST /api/v2/import/files       上传 .md/.txt 导入
 *   GET  /api/v2/deck               获取当前用户牌堆（不含 passage 等大字段，仅 id+title+suit）
 *   POST /api/v2/draw/single        抽 1 张
 *   POST /api/v2/draw/three         抽 3 张
 *   POST /api/v2/dialogue/turn      深度对话单轮
 *   GET  /api/v2/history            抽牌历史
 *
 * 用户识别：基于 httpOnly cookie 的匿名 ID（首次访问自动签发），无需注册。
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = require('../src/storage');
const { processItems } = require('../src/pipeline-v2');
const textdump = require('../src/adapters/textdump');
const chatgpt = require('../src/adapters/chatgpt');
const deepseek = require('../src/adapters/deepseek');
const drawEngine = require('../src/draw-engine');
const ai = require('../src/ai-questioner');

const router = express.Router();
router.use(cookieParser());

// ── User middleware：自动签发 anonymous ID ────────────────
router.use((req, res, next) => {
  let uid = req.cookies?.kt_uid;
  if (!uid || !/^[a-f0-9]{32}$/.test(uid)) {
    uid = storage.newUserId();
    res.cookie('kt_uid', uid, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 365 * 86400000  // 1 年
    });
  }
  req.userId = uid;
  storage.getOrCreateUser(uid);
  next();
});

// ── /api/v2/me ───────────────────────────────────────────
router.get('/me', (req, res) => {
  const profile = storage.getOrCreateUser(req.userId);
  const deck = storage.getDeck(req.userId);
  res.json({
    user: profile,
    deckSize: deck.cards.length,
    lastImport: deck.meta?.lastImport || null
  });
});

router.post('/me/style', express.json(), (req, res) => {
  const allowed = ['gentle', 'sharp', 'philosophical', 'playful'];
  const style = req.body?.style;
  if (!allowed.includes(style)) {
    return res.status(400).json({ error: 'Invalid style' });
  }
  const profile = storage.updateUser(req.userId, { style });
  res.json({ user: profile });
});

// ── /api/v2/import/text ──────────────────────────────────
router.post('/import/text', express.json({ limit: '10mb' }), async (req, res) => {
  const text = req.body?.text;
  const label = req.body?.label || 'pasted';
  if (!text || typeof text !== 'string' || text.trim().length < 30) {
    return res.status(400).json({ error: 'Text too short (min 30 chars)' });
  }
  try {
    const items = textdump.loadFromText(text, label);
    const { cards, stats } = await processItems(items);
    const result = storage.appendCards(req.userId, cards, {
      source: 'paste',
      at: Date.now(),
      stats
    });
    res.json({ ok: true, ...result, stats });
  } catch (e) {
    console.error('[import/text] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── /api/v2/import/files ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 50 }
});

router.post('/import/files', upload.array('files', 50), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  try {
    const items = [];
    for (const f of files) {
      const text = f.buffer.toString('utf-8');
      if (!text.trim()) continue;

      // 识别 JSON 来源：DeepSeek 优先（fragments 是它的特征），其次 ChatGPT
      if (f.originalname.toLowerCase().endsWith('.json')) {
        const looksDeepSeek = text.includes('"fragments"') && text.includes('"REQUEST"');
        const looksChatGPT = text.includes('"mapping"') && (text.includes('"author"') || text.includes('"parts"'));

        if (looksDeepSeek) {
          try {
            const dsItems = deepseek.loadFromJSON(text);
            items.push(...dsItems);
            continue;
          } catch (e) {
            console.warn(`[import] DeepSeek parse failed for ${f.originalname}:`, e.message);
          }
        } else if (looksChatGPT) {
          try {
            const cgItems = chatgpt.loadFromJSON(text);
            items.push(...cgItems);
            continue;
          } catch (e) {
            console.warn(`[import] ChatGPT parse failed for ${f.originalname}:`, e.message);
          }
        }
      }

      // 普通 .md / .txt
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

    const { cards, stats } = await processItems(items);
    const result = storage.appendCards(req.userId, cards, {
      source: 'upload',
      at: Date.now(),
      filenames: files.map(f => f.originalname),
      stats
    });
    res.json({ ok: true, ...result, stats });
  } catch (e) {
    console.error('[import/files] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── /api/v2/deck ─────────────────────────────────────────
// 返回轻量版（不含 passage/insights 等大字段，给 UI 列表用）
router.get('/deck', (req, res) => {
  const deck = storage.getDeck(req.userId);
  const lite = deck.cards.map(c => ({
    id: c.id,
    title: c.title,
    suit: c.suit,
    suitName: c.suitName,
    contentType: c.contentType,
    createdAt: c.createdAt
  }));
  res.json({ meta: deck.meta, cards: lite, total: lite.length });
});

// 单张牌完整内容（深度探索时拉取）
router.get('/deck/card/:id', (req, res) => {
  const deck = storage.getDeck(req.userId);
  const card = deck.cards.find(c => c.id === req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  res.json(card);
});

// ── /api/v2/draw/single ──────────────────────────────────
router.post('/draw/single', express.json(), async (req, res) => {
  const question = (req.body?.question || '').trim();
  const profile = storage.getOrCreateUser(req.userId);
  const style = profile.style || 'gentle';
  const deck = storage.getDeck(req.userId);
  if (deck.cards.length === 0) return res.status(400).json({ error: 'Empty deck. Import content first.' });

  const excludeIds = storage.getRecentDrawnIds(req.userId, 7);
  const card = drawEngine.drawSingle(deck.cards, excludeIds);
  if (!card) return res.status(500).json({ error: 'Failed to draw' });

  // 并行：起牌名 + 提问
  const [titles, questions] = await Promise.all([
    ai.nameCards([card], question),
    ai.askSingle(card, question, style)
  ]);
  card.title = titles[0] || card.title || '—';

  storage.appendHistory(req.userId, {
    spread: 'single',
    question: question || null,
    cardIds: [card.id]
  });

  res.json({ card, questions, style });
});

// ── /api/v2/draw/three ───────────────────────────────────
router.post('/draw/three', express.json(), async (req, res) => {
  const question = (req.body?.question || '').trim();
  const profile = storage.getOrCreateUser(req.userId);
  const style = profile.style || 'gentle';
  const deck = storage.getDeck(req.userId);
  if (deck.cards.length < 3) return res.status(400).json({ error: 'Need at least 3 cards in deck.' });

  const excludeIds = storage.getRecentDrawnIds(req.userId, 7);
  const cards = drawEngine.drawThree(deck.cards, excludeIds);
  if (cards.length < 3) return res.status(500).json({ error: 'Failed to draw three' });

  // 并行：起 3 张牌名 + 三牌阵叙事
  const [titles, narrative] = await Promise.all([
    ai.nameCards(cards, question),
    ai.askThree(cards, question, style)
  ]);
  cards.forEach((c, i) => { c.title = titles[i] || c.title || '—'; });

  storage.appendHistory(req.userId, {
    spread: 'three',
    question: question || null,
    cardIds: cards.map(c => c.id)
  });

  res.json({ cards, narrative, style });
});

// ── /api/v2/dialogue/turn ────────────────────────────────
router.post('/dialogue/turn', express.json(), async (req, res) => {
  const { cardId, transcript = [] } = req.body || {};
  if (!cardId) return res.status(400).json({ error: 'cardId required' });

  const deck = storage.getDeck(req.userId);
  const card = deck.cards.find(c => c.id === cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const profile = storage.getOrCreateUser(req.userId);
  const style = profile.style || 'gentle';
  const question = await ai.dialogueTurn(card, transcript, style);
  res.json({ question, style });
});

// ── /api/v2/history ──────────────────────────────────────
router.get('/history', (req, res) => {
  const history = storage.getHistory(req.userId);
  res.json({ history: history.slice(0, 50) });
});

module.exports = router;
