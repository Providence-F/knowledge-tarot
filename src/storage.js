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
      style: 'gentle'  // gentle | sharp | philosophical | playful
    };
    writeJSON(profilePath, profile);
  }
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
  const file = path.join(dir, `${id}.json`);
  const data = { id, ...dialogue, updatedAt: Date.now() };
  writeJSON(file, data);
  return data;
}

function getDialogue(userId, dialogueId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(dialogueId)) return null;
  return readJSON(path.join(userDir(userId), 'dialogues', `${dialogueId}.json`), null);
}

module.exports = {
  newUserId,
  getOrCreateUser,
  updateUser,
  getDeck,
  saveDeck,
  appendCards,
  getHistory,
  appendHistory,
  getRecentDrawnIds,
  saveDialogue,
  getDialogue
};
