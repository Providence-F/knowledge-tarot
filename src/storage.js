/**
 * src/storage.js — 文件式 JSON 存储（v1.1 多牌堆版）
 *
 * data/users/{userId}/profile.json
 * data/users/{userId}/decks/{deckId}.json
 * data/users/{userId}/history.json
 * data/users/{userId}/dialogues/*.json
 * data/users/{userId}/deck.json.bak     旧版迁移备份
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cosineSimilarity } = require('./utils');

const DEDUP_THRESHOLD = 0.92;

const DATA_BASE = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : path.join(__dirname, '..', 'data');
const DATA_ROOT = path.join(DATA_BASE, 'users');
const SHARE_TOKENS_FILE = path.join(DATA_BASE, 'share-tokens.json');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function userDir(userId) {
  if (!/^[a-zA-Z0-9_-]{8,}$/.test(userId)) throw new Error('Invalid userId');
  return path.join(DATA_ROOT, userId);
}

function decksDir(userId) {
  return path.join(userDir(userId), 'decks');
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isValidDeckId(id) {
  return typeof id === 'string' && /^[a-f0-9]{8,32}$/.test(id);
}

function newUserId() {
  return crypto.randomBytes(16).toString('hex');
}

function newDeckId() {
  return crypto.randomBytes(6).toString('hex');
}

function newCardId(prefix = 'card') {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

// ── User ────────────────────────────────────────────────

function getOrCreateUser(userId) {
  const dir = userDir(userId);
  const profilePath = path.join(dir, 'profile.json');
  let profile = readJSON(profilePath, null);
  if (!profile) {
    profile = {
      id: userId,
      createdAt: Date.now(),
      style: 'gentle',
      mode: null,
      activeDeckId: null,
      ownedDeckIds: [],
      onboardedAt: null
    };
    writeJSON(profilePath, profile);
  }
  let dirty = false;
  if (profile.mode === undefined) { profile.mode = null; dirty = true; }
  if (profile.onboardedAt === undefined) { profile.onboardedAt = null; dirty = true; }
  if (profile.activeDeckId === undefined) { profile.activeDeckId = null; dirty = true; }
  if (!Array.isArray(profile.ownedDeckIds)) { profile.ownedDeckIds = []; dirty = true; }
  if (dirty) writeJSON(profilePath, profile);
  return profile;
}

function updateUser(userId, patch) {
  const profilePath = path.join(userDir(userId), 'profile.json');
  const profile = readJSON(profilePath, { id: userId, createdAt: Date.now() });
  Object.assign(profile, patch);
  writeJSON(profilePath, profile);
  return profile;
}

function userExists(userId) {
  if (!/^[a-f0-9]{32}$/.test(userId)) return false;
  return fs.existsSync(path.join(DATA_ROOT, userId));
}

// ── Deck (multi-deck) ───────────────────────────────────

function deckPath(userId, deckId) {
  if (!isValidDeckId(deckId)) throw new Error('Invalid deckId');
  return path.join(decksDir(userId), `${deckId}.json`);
}

function deckExists(userId, deckId) {
  try { return fs.existsSync(deckPath(userId, deckId)); }
  catch { return false; }
}

function createDeck(userId, { name, description = '', emoji = '📚' }) {
  const deckId = newDeckId();
  const now = Date.now();
  const deck = {
    id: deckId,
    ownerId: userId,
    name: (name || '未命名牌堆').slice(0, 60),
    description: (description || '').slice(0, 300),
    emoji: (emoji || '📚').slice(0, 8),
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
    totalCards: 0,
    lastImport: null,
    cards: []
  };
  writeJSON(deckPath(userId, deckId), deck);
  // profile owned 列表
  const profile = getOrCreateUser(userId);
  if (!profile.ownedDeckIds.includes(deckId)) {
    profile.ownedDeckIds.push(deckId);
    if (!profile.activeDeckId) profile.activeDeckId = deckId;
    writeJSON(path.join(userDir(userId), 'profile.json'), profile);
  }
  return deck;
}

function getDeck(userId, deckId) {
  if (!deckId) {
    // 兼容旧调用：返回 active deck
    const profile = getOrCreateUser(userId);
    if (profile.activeDeckId && deckExists(userId, profile.activeDeckId)) {
      return readJSON(deckPath(userId, profile.activeDeckId), { meta: null, cards: [] });
    }
    // fallback：旧文件
    const legacy = readJSON(path.join(userDir(userId), 'deck.json'), null);
    if (legacy) return legacy;
    return { meta: null, cards: [] };
  }
  return readJSON(deckPath(userId, deckId), null);
}

function saveDeck(userId, deckId, deck) {
  if (typeof deckId === 'object' && deckId !== null) {
    // 兼容旧调用 saveDeck(userId, deckObj)
    deck = deckId;
    deckId = deck.id || (getOrCreateUser(userId).activeDeckId);
  }
  if (!deckId) throw new Error('saveDeck requires deckId');
  deck.updatedAt = Date.now();
  deck.totalCards = (deck.cards || []).length;
  writeJSON(deckPath(userId, deckId), deck);
}

function listDecks(userId) {
  const profile = getOrCreateUser(userId);
  const dir = decksDir(userId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const decks = files.map(f => {
    const d = readJSON(path.join(dir, f), null);
    if (!d) return null;
    return {
      id: d.id,
      ownerId: d.ownerId,
      name: d.name,
      description: d.description,
      emoji: d.emoji,
      visibility: d.visibility || 'private',
      totalCards: d.cards?.length || 0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      isActive: d.id === profile.activeDeckId
    };
  }).filter(Boolean);
  decks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return decks;
}

function appendCards(userId, deckIdOrCards, newCardsOrSourceMeta, maybeSourceMeta) {
  // 兼容两种签名：
  //   appendCards(userId, deckId, newCards, sourceMeta)  v1.1
  //   appendCards(userId, newCards, sourceMeta)          v1.0 旧版
  let deckId, newCards, sourceMeta;
  if (Array.isArray(deckIdOrCards)) {
    newCards = deckIdOrCards;
    sourceMeta = newCardsOrSourceMeta;
    deckId = getOrCreateUser(userId).activeDeckId;
    if (!deckId) throw new Error('No active deck; specify deckId');
  } else {
    deckId = deckIdOrCards;
    newCards = newCardsOrSourceMeta;
    sourceMeta = maybeSourceMeta;
  }
  let deck = getDeck(userId, deckId);
  if (!deck) throw new Error('Deck not found: ' + deckId);
  const existingIds = new Set((deck.cards || []).map(c => c.id));
  const idDeduped = newCards.filter(c => !existingIds.has(c.id));

  // cosine 去重：cosine > DEDUP_THRESHOLD 视为重复
  // 只对 newCard 与既有 deck cards 之间去重；新批次内冲突由 hashId 自然规避（id 撞库）
  const existingEmbeddings = (deck.cards || [])
    .filter(c => Array.isArray(c.embedding) && c.embedding.length > 0)
    .map(c => c.embedding);
  let dedupedByEmbedding = 0;
  const added = [];
  for (const card of idDeduped) {
    if (Array.isArray(card.embedding) && card.embedding.length > 0 && existingEmbeddings.length > 0) {
      let dup = false;
      for (const e of existingEmbeddings) {
        if (cosineSimilarity(card.embedding, e) > DEDUP_THRESHOLD) {
          dup = true;
          break;
        }
      }
      if (dup) {
        dedupedByEmbedding++;
        continue;
      }
      // 同批内也去重
      existingEmbeddings.push(card.embedding);
    }
    added.push(card);
  }

  deck.cards = [...(deck.cards || []), ...added];
  deck.lastImport = sourceMeta || null;
  saveDeck(userId, deckId, deck);
  return { added: added.length, deduped: dedupedByEmbedding, total: deck.cards.length, deckId };
}

function removeCard(userId, deckIdOrCardId, maybeCardId) {
  let deckId, cardId;
  if (maybeCardId !== undefined) {
    deckId = deckIdOrCardId; cardId = maybeCardId;
  } else {
    cardId = deckIdOrCardId;
    deckId = getOrCreateUser(userId).activeDeckId;
  }
  const deck = getDeck(userId, deckId);
  if (!deck) return { removed: 0 };
  const before = deck.cards.length;
  deck.cards = deck.cards.filter(c => c.id !== cardId);
  if (deck.cards.length === before) return { removed: 0, total: before };
  saveDeck(userId, deckId, deck);
  return { removed: 1, total: deck.cards.length };
}

function clearDeck(userId, deckId) {
  if (!deckId) deckId = getOrCreateUser(userId).activeDeckId;
  const deck = getDeck(userId, deckId);
  if (!deck) return { total: 0 };
  deck.cards = [];
  deck.lastImport = null;
  saveDeck(userId, deckId, deck);
  return { total: 0 };
}

function removeDeck(userId, deckId) {
  if (!isValidDeckId(deckId)) return { removed: 0 };
  const file = deckPath(userId, deckId);
  if (!fs.existsSync(file)) return { removed: 0 };
  fs.unlinkSync(file);
  const profile = getOrCreateUser(userId);
  profile.ownedDeckIds = (profile.ownedDeckIds || []).filter(id => id !== deckId);
  if (profile.activeDeckId === deckId) {
    profile.activeDeckId = profile.ownedDeckIds[0] || null;
  }
  writeJSON(path.join(userDir(userId), 'profile.json'), profile);
  return { removed: 1 };
}

function renameDeck(userId, deckId, patch) {
  const deck = getDeck(userId, deckId);
  if (!deck) return null;
  if (patch.name !== undefined) deck.name = String(patch.name).slice(0, 60);
  if (patch.description !== undefined) deck.description = String(patch.description).slice(0, 300);
  if (patch.emoji !== undefined) deck.emoji = String(patch.emoji).slice(0, 8);
  saveDeck(userId, deckId, deck);
  return deck;
}

function setActiveDeck(userId, deckId) {
  const profile = getOrCreateUser(userId);
  profile.activeDeckId = deckId || null;
  writeJSON(path.join(userDir(userId), 'profile.json'), profile);
  return profile;
}

/**
 * cloneDeck —— 把任意源 deck（用户私有 / seed deck / 分享 token 拿到的）
 * 复制到目标用户名下成为独立副本。
 */
function cloneDeck(srcDeck, dstUserId, opts = {}) {
  if (!srcDeck || !Array.isArray(srcDeck.cards)) throw new Error('Invalid source deck');
  const newId = newDeckId();
  const now = Date.now();
  const clonedCards = srcDeck.cards.map(c => ({
    ...c,
    id: newCardId('card'),
    _clonedFrom: c.id
  }));
  const newDeck = {
    id: newId,
    ownerId: dstUserId,
    name: opts.name || `我的${srcDeck.name || '克隆牌堆'}`.slice(0, 60),
    description: opts.description !== undefined ? opts.description : (srcDeck.description || ''),
    emoji: opts.emoji || srcDeck.emoji || '📚',
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
    totalCards: clonedCards.length,
    lastImport: { source: 'clone', srcDeckId: srcDeck.id, at: now },
    cards: clonedCards
  };
  writeJSON(deckPath(dstUserId, newId), newDeck);
  const profile = getOrCreateUser(dstUserId);
  profile.ownedDeckIds = profile.ownedDeckIds || [];
  if (!profile.ownedDeckIds.includes(newId)) profile.ownedDeckIds.push(newId);
  if (!profile.activeDeckId) profile.activeDeckId = newId;
  writeJSON(path.join(userDir(dstUserId), 'profile.json'), profile);
  return newDeck;
}

// ── Share tokens ────────────────────────────────────────

function readShareTokens() {
  return readJSON(SHARE_TOKENS_FILE, {});
}

function writeShareTokens(map) {
  writeJSON(SHARE_TOKENS_FILE, map);
}

function createShareToken(srcUserId, srcDeckId, expiresInDays = 30) {
  const token = crypto.randomBytes(12).toString('base64url');
  const map = readShareTokens();
  map[token] = {
    srcUserId,
    srcDeckId,
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresInDays * 86400000
  };
  writeShareTokens(map);
  return token;
}

function getShareToken(token) {
  if (!token || typeof token !== 'string') return null;
  const map = readShareTokens();
  const t = map[token];
  if (!t) return null;
  if (t.expiresAt && t.expiresAt < Date.now()) return null;
  return t;
}

function revokeShareToken(token) {
  const map = readShareTokens();
  if (map[token]) {
    delete map[token];
    writeShareTokens(map);
  }
}

// ── History ─────────────────────────────────────────────

function getHistory(userId) {
  return readJSON(path.join(userDir(userId), 'history.json'), []);
}

function appendHistory(userId, entry) {
  const history = getHistory(userId);
  history.unshift({ ...entry, drawnAt: Date.now() });
  const trimmed = history.slice(0, 200);
  writeJSON(path.join(userDir(userId), 'history.json'), trimmed);
  return trimmed;
}

function removeHistoryEntry(userId, drawnAt) {
  const history = getHistory(userId);
  const before = history.length;
  const after = history.filter(h => h.drawnAt !== drawnAt);
  if (after.length === before) return { removed: 0 };
  writeJSON(path.join(userDir(userId), 'history.json'), after);
  return { removed: 1 };
}

function clearHistory(userId) {
  writeJSON(path.join(userDir(userId), 'history.json'), []);
  return { ok: true };
}

function getRecentDrawnIds(userId, days = 7, deckId = null) {
  const history = getHistory(userId);
  const cutoff = Date.now() - days * 86400000;
  const ids = new Set();
  for (const h of history) {
    if (h.drawnAt < cutoff) break;
    if (deckId && h.deckId && h.deckId !== deckId) continue;
    if (Array.isArray(h.cardIds)) {
      h.cardIds.forEach(id => ids.add(id));
    }
  }
  return ids;
}

// ── Dialogues ───────────────────────────────────────────

function saveDialogue(userId, dialogue) {
  const dir = path.join(userDir(userId), 'dialogues');
  ensureDir(dir);
  const id = dialogue.id || crypto.randomBytes(8).toString('hex');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid dialogue id');
  const file = path.join(dir, `${id}.json`);
  const data = { id, ...dialogue, updatedAt: Date.now() };
  writeJSON(file, data);
  return data;
}

function getDialogue(userId, dialogueId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(dialogueId)) return null;
  return readJSON(path.join(userDir(userId), 'dialogues', `${dialogueId}.json`), null);
}

function listDialogues(userId) {
  const dir = path.join(userDir(userId), 'dialogues');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJSON(path.join(dir, f), null))
    .filter(Boolean)
    .map(d => ({
      id: d.id,
      cardIds: d.cardIds || (d.cardId ? [d.cardId] : []),
      cardTitles: d.cardTitles || [],
      style: d.style,
      deckId: d.deckId || null,
      turns: (d.transcript || []).length,
      updatedAt: d.updatedAt,
      createdAt: d.createdAt || d.updatedAt
    }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function removeDialogue(userId, dialogueId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(dialogueId)) return { removed: 0 };
  const file = path.join(userDir(userId), 'dialogues', `${dialogueId}.json`);
  if (!fs.existsSync(file)) return { removed: 0 };
  fs.unlinkSync(file);
  return { removed: 1 };
}

module.exports = {
  newUserId,
  newDeckId,
  newCardId,
  isValidDeckId,
  userExists,
  getOrCreateUser,
  updateUser,
  // multi-deck
  createDeck,
  getDeck,
  saveDeck,
  listDecks,
  appendCards,
  removeCard,
  clearDeck,
  removeDeck,
  renameDeck,
  setActiveDeck,
  cloneDeck,
  deckExists,
  // share
  createShareToken,
  getShareToken,
  revokeShareToken,
  // history
  getHistory,
  appendHistory,
  removeHistoryEntry,
  clearHistory,
  getRecentDrawnIds,
  // dialogue
  saveDialogue,
  getDialogue,
  listDialogues,
  removeDialogue
};
