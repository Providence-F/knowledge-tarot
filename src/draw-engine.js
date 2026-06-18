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
 *
 * 反馈（feedback）支持：
 *   - blocked 直接排除
 *   - starred 0.5x 降权（重逢已熟悉的卡价值低）
 *
 * 正逆位：50% 二项随机，逆位提问角度更尖锐
 */

const { cosineSimilarity } = require('./utils');

const SWEET_LO = 0.4;
const SWEET_HI = 0.7;
const SURPRISE_LO = 0.2;
const SMALL_DECK = 30;
const SWEET_WEIGHT = 0.7;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const OLD_CARD_WEIGHT = 2.0; // 90 天+ 老卡 2x
const STAR_DOWNWEIGHT = 0.5; // ⭐ 卡降权（已熟悉，重逢感弱）
const REVERSED_PROBABILITY = 0.5;

function pickRandom(arr) {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightOf(card, now, starred) {
  let w = 1.0;
  const age = now - (card.createdAt || now);
  if (age >= NINETY_DAYS_MS) w *= OLD_CARD_WEIGHT;
  if (starred && starred.has(card.id)) w *= STAR_DOWNWEIGHT;
  return w;
}

function pickWeighted(arr, now = Date.now(), starred = null) {
  if (arr.length === 0) return null;
  const weights = arr.map(c => weightOf(c, now, starred));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return arr[Math.floor(Math.random() * arr.length)];
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

function pickFromBucketWeighted(bucket, now = Date.now(), starred = null) {
  if (bucket.length === 0) return null;
  const arr = bucket.map(b => b.card);
  const picked = pickWeighted(arr, now, starred);
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

function pickFromBuckets(sweet, surprise, now = Date.now(), starred = null) {
  const useSweet = Math.random() < SWEET_WEIGHT;
  if (useSweet && sweet.length > 0) return pickFromBucketWeighted(sweet, now, starred);
  if (surprise.length > 0) return pickFromBucketWeighted(surprise, now, starred);
  if (sweet.length > 0) return pickFromBucketWeighted(sweet, now, starred);
  return null;
}

function rollOrientation() {
  return Math.random() < REVERSED_PROBABILITY ? 'reversed' : 'upright';
}

/**
 * @param {Card[]} deckCards
 * @param {Set<string>} excludeIds
 * @param {number[]|null} questionEmbedding
 * @param {{stars:Set<string>, blocks:Set<string>}|null} feedback
 * @returns {Card | null}
 */
function drawSingle(deckCards, excludeIds = new Set(), questionEmbedding = null, feedback = null) {
  if (!deckCards || deckCards.length === 0) return null;
  const blocks = feedback?.blocks || new Set();
  const stars = feedback?.stars || null;

  // 1) 排除最近抽过 + blocked
  const filtered = deckCards.filter(c => !excludeIds.has(c.id) && !blocks.has(c.id));
  // 如果连 blocked 都过滤完了，至少保留 unblocked
  let pool = filtered;
  let recycled = false;
  if (pool.length === 0) {
    pool = deckCards.filter(c => !blocks.has(c.id));
    recycled = true;
  }
  if (pool.length === 0) return null;

  const hasQ = Array.isArray(questionEmbedding) && questionEmbedding.length > 0;
  const small = pool.length < SMALL_DECK;

  if (!hasQ || small) {
    const card = pickWeighted(pool, Date.now(), stars);
    if (!card) return null;
    return {
      ...card,
      orientation: rollOrientation(),
      position: 'daily',
      positionName: '日签',
      _drawMeta: { mode: 'random', reason: !hasQ ? 'no_question' : 'small_deck', recycled }
    };
  }

  const { sweet, surprise } = bucketize(pool, questionEmbedding);
  const chosen = pickFromBuckets(sweet, surprise, Date.now(), stars);

  if (!chosen) {
    const card = pickWeighted(pool, Date.now(), stars);
    if (!card) return null;
    return {
      ...card,
      orientation: rollOrientation(),
      position: 'daily',
      positionName: '日签',
      _drawMeta: { mode: 'random', reason: 'empty_buckets', recycled, sweetCount: 0, surpriseCount: 0 }
    };
  }

  return {
    ...chosen.card,
    orientation: rollOrientation(),
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
 * @returns {Card[]} 长度 0-3
 */
function drawThree(deckCards, excludeIds = new Set(), questionEmbedding = null, feedback = null) {
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
    const picked = drawSingle(remaining, new Set(), questionEmbedding, feedback);
    if (!picked) break;
    result.push({ ...picked, position: pos.key, positionName: pos.name });
    sessionExclude.add(picked.id);
  }
  return result;
}

// ── deck 健康度（T23）──────────────────────────────────
function deckStats(cards, sampleEmbedding = null, feedback = null) {
  if (!Array.isArray(cards)) return null;
  const total = cards.length;
  const now = Date.now();
  const ages = cards.map(c => (now - (c.createdAt || now)) / 86400000);
  const avgAgeDays = total > 0 ? ages.reduce((a, b) => a + b, 0) / total : 0;
  const olderThan90 = cards.filter(c => (now - (c.createdAt || now)) >= NINETY_DAYS_MS).length;
  const withEmbedding = cards.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0).length;
  const stars = feedback?.stars?.size || 0;
  const blocks = feedback?.blocks?.size || 0;

  let coverage = null;
  if (sampleEmbedding && Array.isArray(sampleEmbedding) && sampleEmbedding.length > 0 && withEmbedding > 0) {
    let rag = 0, sweet = 0, surprise = 0, irrelevant = 0;
    for (const c of cards) {
      if (!Array.isArray(c.embedding) || c.embedding.length === 0) continue;
      const sim = cosineSimilarity(c.embedding, sampleEmbedding);
      if (sim >= SWEET_HI) rag++;
      else if (sim >= SWEET_LO) sweet++;
      else if (sim >= SURPRISE_LO) surprise++;
      else irrelevant++;
    }
    coverage = { rag, sweet, surprise, irrelevant };
  }

  let health;
  if (total < 30) health = 'cold_start';
  else if (total < 100) health = 'early';
  else if (total <= 500) health = 'sweet';
  else if (total <= 1000) health = 'large';
  else health = 'oversized';

  return {
    total,
    avgAgeDays: Number(avgAgeDays.toFixed(1)),
    olderThan90Days: olderThan90,
    withEmbedding,
    starredCount: stars,
    blockedCount: blocks,
    coverage,
    health
  };
}

module.exports = {
  drawSingle, drawThree, deckStats,
  SMALL_DECK, SWEET_LO, SWEET_HI, SURPRISE_LO, OLD_CARD_WEIGHT, STAR_DOWNWEIGHT
};
