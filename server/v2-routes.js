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
const publicDeck = require('../src/public-deck');
const { processItems } = require('../src/pipeline-v2');
const textdump = require('../src/adapters/textdump');
const chatgpt = require('../src/adapters/chatgpt');
const deepseek = require('../src/adapters/deepseek');
const drawEngine = require('../src/draw-engine');
const ai = require('../src/ai-questioner');

const router = express.Router();
router.use(cookieParser());

// ── User middleware：自动签发 anonymous ID ────────────────
// COOKIE_SECURE 取决于请求实际是否 HTTPS（兼容 HTTP IP 直访 + 反代后的 HTTPS）
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
  const pubMeta = publicDeck.getMeta();
  res.json({
    user: profile,
    userId: req.userId,
    userIdShort: req.userId.slice(0, 8),
    deckSize: deck.cards.length,
    lastImport: deck.meta?.lastImport || null,
    publicDeck: pubMeta ? {
      available: publicDeck.isReady(),
      name: pubMeta.name,
      description: pubMeta.description,
      totalCards: pubMeta.totalCards,
      sourceLabel: pubMeta.sourceLabel
    } : { available: false }
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

// ── /api/v2/me/mode ──────────────────────────────────────
// 引导墙选择：'public' = 用公共牌堆试玩；'private' = 导入自己内容
router.post('/me/mode', express.json(), (req, res) => {
  const mode = req.body?.mode;
  if (!['public', 'private'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "public" or "private"' });
  }
  if (mode === 'public' && !publicDeck.isReady()) {
    return res.status(503).json({ error: '公共牌堆暂未就绪，请稍后再试或选择导入自己的内容' });
  }
  const profile = storage.updateUser(req.userId, { mode, onboardedAt: Date.now() });
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
const MAX_TOTAL_UPLOAD = 100 * 1024 * 1024; // 100MB 总和
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 50 }
});

router.post('/import/files', upload.array('files', 50), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  // 累计总大小检查
  const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0);
  if (totalBytes > MAX_TOTAL_UPLOAD) {
    return res.status(413).json({ error: `所有文件总大小超出 ${MAX_TOTAL_UPLOAD / 1024 / 1024}MB 限制` });
  }

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
// 支持 ?mode=public 查看公共牌堆
router.get('/deck', (req, res) => {
  const mode = req.query.mode === 'public' ? 'public' : 'private';
  if (mode === 'public') {
    if (!publicDeck.isReady()) return res.json({ meta: null, cards: [], total: 0 });
    const cards = publicDeck.getCards();
    const lite = cards.map(c => ({
      id: c.id,
      title: c.title,
      suit: c.suit,
      suitName: c.suitName,
      contentType: c.contentType,
      createdAt: c.createdAt
    }));
    return res.json({ meta: publicDeck.getMeta(), cards: lite, total: lite.length, isPublic: true });
  }
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
  const profile = storage.getOrCreateUser(req.userId);
  const isPublicMode = profile.mode === 'public';
  const deck = storage.getDeck(req.userId);
  // public 模式只允许读 public 牌；private 模式可读自己 + public（fallback）
  let card = null;
  if (isPublicMode) {
    card = publicDeck.getCardById(req.params.id);
  } else {
    card = deck.cards.find(c => c.id === req.params.id) || publicDeck.getCardById(req.params.id);
  }
  if (!card) return res.status(404).json({ error: 'Card not found' });
  res.json(card);
});

// 抽牌时根据 profile.mode 决定用哪副牌
function pickDeckForUser(profile, userId) {
  if (profile.mode === 'public' && publicDeck.isReady()) {
    return { cards: publicDeck.getCards(), isPublic: true };
  }
  const deck = storage.getDeck(userId);
  return { cards: deck.cards, isPublic: false };
}

// ── /api/v2/draw/single ──────────────────────────────────
router.post('/draw/single', express.json(), async (req, res) => {
  const question = (req.body?.question || '').trim();
  const profile = storage.getOrCreateUser(req.userId);
  const style = profile.style || 'gentle';
  const { cards: pool, isPublic } = pickDeckForUser(profile, req.userId);
  if (pool.length === 0) return res.status(400).json({ error: 'Empty deck. Import content first.' });

  const excludeIds = isPublic ? new Set() : storage.getRecentDrawnIds(req.userId, 7);
  const card = drawEngine.drawSingle(pool, excludeIds);
  if (!card) return res.status(500).json({ error: 'Failed to draw' });

  // 并行：起牌名 + 提问
  const [titles, questions] = await Promise.all([
    ai.nameCards([card], question),
    ai.askSingle(card, question, style)
  ]);
  card.title = titles[0] || card.title || '—';

  // 公共牌堆抽牌不计入用户的 history（让公共体验真正"无痕")
  if (!isPublic) {
    storage.appendHistory(req.userId, {
      spread: 'single',
      question: question || null,
      cardIds: [card.id]
    });
  }

  res.json({ card, questions, style, isPublic });
});

// ── /api/v2/draw/three ───────────────────────────────────
router.post('/draw/three', express.json(), async (req, res) => {
  const question = (req.body?.question || '').trim();
  const profile = storage.getOrCreateUser(req.userId);
  const style = profile.style || 'gentle';
  const { cards: pool, isPublic } = pickDeckForUser(profile, req.userId);
  if (pool.length < 3) return res.status(400).json({ error: 'Need at least 3 cards in deck.' });

  const excludeIds = isPublic ? new Set() : storage.getRecentDrawnIds(req.userId, 7);
  const cards = drawEngine.drawThree(pool, excludeIds);
  if (cards.length < 3) return res.status(500).json({ error: 'Failed to draw three' });

  // 并行：起 3 张牌名 + 三牌阵叙事
  const [titles, narrative] = await Promise.all([
    ai.nameCards(cards, question),
    ai.askThree(cards, question, style)
  ]);
  cards.forEach((c, i) => { c.title = titles[i] || c.title || '—'; });

  if (!isPublic) {
    storage.appendHistory(req.userId, {
      spread: 'three',
      question: question || null,
      cardIds: cards.map(c => c.id)
    });
  }

  res.json({ cards, narrative, style, isPublic });
});

// ── /api/v2/dialogue/turn ────────────────────────────────
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
  const { cardId, cardIds, dialogueId, transcript = [], userQuestion = '' } = req.body || {};
  const ids = Array.isArray(cardIds) && cardIds.length > 0
    ? cardIds
    : (cardId ? [cardId] : []);
  if (ids.length === 0) return res.status(400).json({ error: 'cardId or cardIds required' });
  if (ids.length > 5) return res.status(400).json({ error: 'too many cards (max 5)' });
  if (typeof userQuestion !== 'string' || userQuestion.length > MAX_USER_QUESTION_LEN) {
    return res.status(400).json({ error: `userQuestion too long (max ${MAX_USER_QUESTION_LEN})` });
  }
  const v = validateTranscript(transcript);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const profile = storage.getOrCreateUser(req.userId);
  const isPublic = profile.mode === 'public';

  // owner 校验：每个 cardId 必须属于当前用户的牌堆 OR public 牌堆
  const personalDeck = storage.getDeck(req.userId);
  const cards = [];
  for (const id of ids) {
    let c = null;
    if (isPublic) {
      c = publicDeck.getCardById(id); // public 模式只能用 public 牌
    } else {
      c = personalDeck.cards.find(x => x.id === id) || publicDeck.getCardById(id);
    }
    if (!c) return res.status(403).json({ error: 'Card not accessible' });
    cards.push(c);
  }

  const style = profile.style || 'gentle';
  const question = await ai.dialogueTurn(cards, transcript, style, userQuestion);

  // 公共牌堆下 dialogue 不落盘（试玩模式无痕）；private 模式才存档
  let savedId = dialogueId;
  if (!isPublic) {
    const newTranscript = [...(transcript || []), { role: 'ai', text: question }];
    const id = (dialogueId && /^[a-zA-Z0-9_-]+$/.test(dialogueId))
      ? dialogueId
      : require('crypto').randomBytes(8).toString('hex');
    const saved = storage.saveDialogue(req.userId, {
      id,
      cardIds: ids,
      cardTitles: cards.map(c => c.title || '—'),
      style,
      userQuestion: userQuestion || null,
      transcript: newTranscript,
      createdAt: (storage.getDialogue(req.userId, id)?.createdAt) || Date.now()
    });
    savedId = saved.id;
  }

  res.json({ question, style, dialogueId: savedId || null, isPublic });
});

// ── /api/v2/dialogues ────────────────────────────────────
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

// ── 牌堆管理 ─────────────────────────────────────────────
router.delete('/deck', (req, res) => {
  res.json(storage.clearDeck(req.userId));
});

router.delete('/deck/card/:id', (req, res) => {
  res.json(storage.removeCard(req.userId, req.params.id));
});

// ── 历史管理 ─────────────────────────────────────────────
router.delete('/history', (req, res) => {
  res.json(storage.clearHistory(req.userId));
});

router.delete('/history/:drawnAt', (req, res) => {
  const t = parseInt(req.params.drawnAt, 10);
  if (!t) return res.status(400).json({ error: 'Invalid drawnAt' });
  res.json(storage.removeHistoryEntry(req.userId, t));
});

// ── 身份导出 / 导入 ──────────────────────────────────────
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

// ── /api/v2/history ──────────────────────────────────────
router.get('/history', (req, res) => {
  const history = storage.getHistory(req.userId);
  res.json({ history: history.slice(0, 50) });
});

module.exports = router;
