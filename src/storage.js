/**
 * src/storage.js — 文件式 JSON 存储
 *
 * MVP 阶段不引入 SQL。数据按"用户"分文件夹存：
 *   data/users/{userId}/profile.json     用户基本信息
 *   data/users/{userId}/deck.json        用户的牌堆
 *   data/users/{userId}/history.json     抽牌历史（最近 200 次）
 *   data/users/{userId}/dialogues/*.json 深度对话记录
 *
 * 简单、可读、可手动调试、迁移到 SQL 很容易。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = path.join(__dirname, '..', 'data', 'users');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function userDir(userId) {
  if (!/^[a-zA-Z0-9_-]{8,}$/.test(userId)) throw new Error('Invalid userId');
  return path.join(DATA_ROOT, userId);
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── User ────────────────────────────────────────────────

function newUserId() {
  return crypto.randomBytes(16).toString('hex');
}

function getOrCreateUser(userId) {
  const dir = userDir(userId);
  const profilePath = path.join(dir, 'profile.json');
  let profile = readJSON(profilePath, null);
  if (!profile) {
    profile = {
      id: userId,
      createdAt: Date.now(),
      style: 'gentle',  // gentle | sharp | philosophical | playful
      mode: null,        // null | 'public' | 'private'   未选 = 显示引导墙
      onboardedAt: null
    };
    writeJSON(profilePath, profile);
  }
  // 兼容老 profile：补字段
  let dirty = false;
  if (profile.mode === undefined) { profile.mode = null; dirty = true; }
  if (profile.onboardedAt === undefined) { profile.onboardedAt = null; dirty = true; }
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

// ── Deck ────────────────────────────────────────────────

function getDeck(userId) {
  return readJSON(path.join(userDir(userId), 'deck.json'), { meta: null, cards: [] });
}

function saveDeck(userId, deck) {
  writeJSON(path.join(userDir(userId), 'deck.json'), deck);
}

function appendCards(userId, newCards, sourceMeta) {
  const deck = getDeck(userId);
  const existingIds = new Set(deck.cards.map(c => c.id));
  const added = newCards.filter(c => !existingIds.has(c.id));
  deck.cards = [...deck.cards, ...added];
  deck.meta = {
    updatedAt: Date.now(),
    totalCards: deck.cards.length,
    lastImport: sourceMeta || null
  };
  saveDeck(userId, deck);
  return { added: added.length, total: deck.cards.length };
}

function removeCard(userId, cardId) {
  const deck = getDeck(userId);
  const before = deck.cards.length;
  deck.cards = deck.cards.filter(c => c.id !== cardId);
  if (deck.cards.length === before) return { removed: 0, total: before };
  deck.meta = { ...(deck.meta || {}), updatedAt: Date.now(), totalCards: deck.cards.length };
  saveDeck(userId, deck);
  return { removed: 1, total: deck.cards.length };
}

function clearDeck(userId) {
  saveDeck(userId, { meta: { updatedAt: Date.now(), totalCards: 0, lastImport: null }, cards: [] });
  return { total: 0 };
}

// ── History ─────────────────────────────────────────────

function getHistory(userId) {
  return readJSON(path.join(userDir(userId), 'history.json'), []);
}

function appendHistory(userId, entry) {
  const history = getHistory(userId);
  history.unshift({ ...entry, drawnAt: Date.now() });
  // 只保留最近 200 次
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

function getRecentDrawnIds(userId, days = 7) {
  const history = getHistory(userId);
  const cutoff = Date.now() - days * 86400000;
  const ids = new Set();
  for (const h of history) {
    if (h.drawnAt < cutoff) break;
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

function userExists(userId) {
  if (!/^[a-f0-9]{32}$/.test(userId)) return false;
  return fs.existsSync(path.join(DATA_ROOT, userId));
}

module.exports = {
  newUserId,
  userExists,
  getOrCreateUser,
  updateUser,
  getDeck,
  saveDeck,
  appendCards,
  removeCard,
  clearDeck,
  getHistory,
  appendHistory,
  removeHistoryEntry,
  clearHistory,
  getRecentDrawnIds,
  saveDialogue,
  getDialogue,
  listDialogues,
  removeDialogue
};
