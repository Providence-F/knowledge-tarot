/**
 * src/public-deck.js — 公共示例牌堆 service
 *
 * 启动时把 data/public-deck.json 整个加载到内存，所有 demo 模式用户共享只读。
 * 文件不存在时返回 null；server 仍能跑，只是抽公共牌堆会拒绝。
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'public-deck.json');

let cache = null;
let loadedAt = 0;

function load() {
  try {
    if (!fs.existsSync(FILE)) {
      console.warn('[public-deck] data/public-deck.json 不存在，公共牌堆功能未启用');
      cache = null;
      return null;
    }
    const raw = fs.readFileSync(FILE, 'utf-8');
    const data = JSON.parse(raw);
    cache = data;
    loadedAt = Date.now();
    console.log(`[public-deck] 已加载: ${data.cards?.length || 0} 张 (${data.meta?.name || '未命名'})`);
    return data;
  } catch (e) {
    console.error('[public-deck] 加载失败:', e.message);
    cache = null;
    return null;
  }
}

function isReady() {
  return !!cache && Array.isArray(cache.cards) && cache.cards.length > 0;
}

function getMeta() {
  if (!cache) return null;
  return {
    ...(cache.meta || {}),
    totalCards: cache.cards?.length || 0,
    loadedAt
  };
}

function getCards() {
  return cache?.cards || [];
}

function getCardById(id) {
  return (cache?.cards || []).find(c => c.id === id) || null;
}

// 启动时加载
load();

module.exports = { load, isReady, getMeta, getCards, getCardById };
