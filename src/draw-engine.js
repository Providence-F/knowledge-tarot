/**
 * src/draw-engine.js — 抽牌引擎
 *
 * 设计：
 *   - drawSingle / drawThree：随机选 + 排除最近抽过的 + 三牌阵 id 不重复
 *   - 三牌阵不再硬性绑定花色（"过去/现在/未来"是凭空贴的标签，符合 OH 卡机制）
 */

function pickRandom(arr) {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * @param {Card[]} deckCards 用户全部牌堆
 * @param {Set<string>} excludeIds 排除的牌 id（最近抽过 + 本会话已抽）
 * @returns {Card | null}
 */
function drawSingle(deckCards, excludeIds = new Set()) {
  if (!deckCards || deckCards.length === 0) return null;
  const pool = deckCards.filter(c => !excludeIds.has(c.id));
  // 池子被排空时退化到全集
  const finalPool = pool.length > 0 ? pool : deckCards;
  const card = pickRandom(finalPool);
  return card ? { ...card, position: 'daily', positionName: '日签' } : null;
}

/**
 * @param {Card[]} deckCards
 * @param {Set<string>} excludeIds
 * @returns {Card[]} 长度 0-3
 */
function drawThree(deckCards, excludeIds = new Set()) {
  if (!deckCards || deckCards.length === 0) return [];
  const positions = [
    { key: 'past', name: '过去' },
    { key: 'present', name: '现在' },
    { key: 'future', name: '未来' }
  ];

  const sessionExclude = new Set(excludeIds);
  const result = [];
  for (const pos of positions) {
    const pool = deckCards.filter(c => !sessionExclude.has(c.id));
    const finalPool = pool.length > 0 ? pool : deckCards.filter(c => !result.find(r => r.id === c.id));
    const card = pickRandom(finalPool);
    if (!card) break;
    result.push({ ...card, position: pos.key, positionName: pos.name });
    sessionExclude.add(card.id);
  }
  return result;
}

module.exports = { drawSingle, drawThree };
