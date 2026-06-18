/**
 * src/draw-engine.js — 抽牌引擎
 *
 * 反向 RAG（Inverse RAG / 留白 RAG）分桶抽样：
 *   sim ≥ 0.7   "RAG 区"     → 不抽（答疑，不是塔罗）
 *   0.4-0.7     "若有似无区" → 重点抽样池，权重 70%
 *   0.2-0.4     "意外区"     → 权重 30%
 *   sim < 0.2   "完全无关"   → 不抽（联想成本过高）
 *
 * 降级条件（任一触发即纯随机）：
 *   - deckCards.length < 30：相似度分布稀疏
 *   - questionEmbedding 缺失或空（用户没填问题）
 *   - 两桶都空（这次提问跟所有卡都太远 / 都太近）
 *
 * embedding === null 的卡仍可被纯随机抽到，反向 RAG 路径会跳过
 */

const { cosineSimilarity } = require('./utils');

const SWEET_LO = 0.4;
const SWEET_HI = 0.7;
const SURPRISE_LO = 0.2;
const SMALL_DECK = 30;
const SWEET_WEIGHT = 0.7;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const OLD_CARD_WEIGHT = 2.0; // 90 天+ 老卡 2x

function pickRandom(arr) {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// 按 createdAt 加权取一张：90 天+ 老卡权重 2x，新卡 1x
function pickWeightedByAge(arr, now = Date.now()) {
  if (arr.length === 0) return null;
  const weights = arr.map(c => {
    const age = now - (c.createdAt || now);
    return age >= NINETY_DAYS_MS ? OLD_CARD_WEIGHT : 1.0;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

// 桶内按 age 加权
function pickFromBucketWeighted(bucket, now = Date.now()) {
  if (bucket.length === 0) return null;
  const arr = bucket.map(b => b.card);
  const picked = pickWeightedByAge(arr, now);
  return bucket.find(b => b.card === picked) || bucket[0];
}

function bucketize(cards, questionEmbedding) {
  const sweet = [];
  const surprise = [];
  for (const c of cards) {
    if (!Array.isArray(c.embedding) || c.embedding.length === 0) continue;
    const sim = cosineSimilarity(c.embedding, questionEmbedding);
    if (sim >= SWEET_LO && sim < SWEET_HI) sweet.push({ card: c, sim });
    else if (sim >= SURPRISE_LO && sim < SWEET_LO) surprise.push({ card: c, sim });
  }
  return { sweet, surprise };
}

function pickFromBuckets(sweet, surprise, now = Date.now()) {
  const useSweet = Math.random() < SWEET_WEIGHT;
  if (useSweet && sweet.length > 0) return pickFromBucketWeighted(sweet, now);
  if (surprise.length > 0) return pickFromBucketWeighted(surprise, now);
  if (sweet.length > 0) return pickFromBucketWeighted(sweet, now);
  return null;
}

/**
 * @param {Card[]} deckCards
 * @param {Set<string>} excludeIds
 * @param {number[]|null} questionEmbedding 用户问题的 512 维向量（可空）
 * @returns {Card | null}
 */
function drawSingle(deckCards, excludeIds = new Set(), questionEmbedding = null) {
  if (!deckCards || deckCards.length === 0) return null;
  const filtered = deckCards.filter(c => !excludeIds.has(c.id));
  const pool = filtered.length > 0 ? filtered : deckCards;
  const recycled = filtered.length === 0;

  const hasQ = Array.isArray(questionEmbedding) && questionEmbedding.length > 0;
  const small = pool.length < SMALL_DECK;

  if (!hasQ || small) {
    const card = pickWeightedByAge(pool);
    if (!card) return null;
    return {
      ...card,
      position: 'daily',
      positionName: '日签',
      _drawMeta: { mode: 'random', reason: !hasQ ? 'no_question' : 'small_deck', recycled }
    };
  }

  const { sweet, surprise } = bucketize(pool, questionEmbedding);
  const chosen = pickFromBuckets(sweet, surprise);

  if (!chosen) {
    const card = pickWeightedByAge(pool);
    if (!card) return null;
    return {
      ...card,
      position: 'daily',
      positionName: '日签',
      _drawMeta: { mode: 'random', reason: 'empty_buckets', recycled, sweetCount: 0, surpriseCount: 0 }
    };
  }

  return {
    ...chosen.card,
    position: 'daily',
    positionName: '日签',
    _drawMeta: {
      mode: 'inverse_rag',
      sim: Number(chosen.sim.toFixed(4)),
      bucket: chosen.sim >= SWEET_LO ? 'sweet' : 'surprise',
      sweetCount: sweet.length,
      surpriseCount: surprise.length,
      recycled
    }
  };
}

/**
 * @param {Card[]} deckCards
 * @param {Set<string>} excludeIds
 * @param {number[]|null} questionEmbedding
 * @returns {Card[]} 长度 0-3
 */
function drawThree(deckCards, excludeIds = new Set(), questionEmbedding = null) {
  if (!deckCards || deckCards.length === 0) return [];
  const positions = [
    { key: 'past', name: '过去' },
    { key: 'present', name: '现在' },
    { key: 'future', name: '未来' }
  ];

  const sessionExclude = new Set(excludeIds);
  const result = [];
  for (const pos of positions) {
    const remaining = deckCards.filter(c => !sessionExclude.has(c.id));
    if (remaining.length === 0) break;
    const picked = drawSingle(remaining, new Set(), questionEmbedding);
    if (!picked) break;
    result.push({ ...picked, position: pos.key, positionName: pos.name });
    sessionExclude.add(picked.id);
  }
  return result;
}

module.exports = { drawSingle, drawThree, SMALL_DECK, SWEET_LO, SWEET_HI, SURPRISE_LO };
