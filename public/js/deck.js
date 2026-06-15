/**
 * deck.js — 抽牌、洗牌、牌阵、匹配算法
 */

const Deck = (function() {
  let cards = [];
  let meta = {};
  let cardHistory = {}; // id -> { lastDrawn: timestamp, count: number }

  // Chinese stop words (simplified)
  const STOP_WORDS = new Set([
    '的','了','在','是','我','有','和','就','不','人','都','一','一个','上','也','很','到','说','要','去','你','会','着','没有','看','好','自己','这','那','这些','那些','什么','怎么','为什么','如何','可以','还是','或者','如果','因为','所以','但是','然后','而且','虽然','这样','那样','这里','那里','现在','今天','明天','昨天','时候','之间','之前','之后','一下','一些','一种','一直','一样','一般','一下儿'
  ]);

  async function load() {
    const res = await fetch('data/cards.json');
    const data = await res.json();
    cards = data.cards;
    meta = data.meta;
    // Load history from localStorage
    try {
      const h = localStorage.getItem('tarot_history');
      if (h) cardHistory = JSON.parse(h);
    } catch {}
    return { cards, meta };
  }

  function getCards() { return cards; }
  function getMeta() { return meta; }

  function extractKeywords(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .split(/[\s,，.。!！?？;；:：""''（）()【】\[\]]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 2 && !STOP_WORDS.has(s));
  }

  function scoreCard(card, question, position) {
    const keywords = extractKeywords(question);
    let score = Math.random() * 0.05; // small random base for variety

    const cardText = [card.title, card.summary, card.scenario, ...card.tags].join(' ').toLowerCase();

    // 1. keyword match
    if (keywords.length > 0) {
      const matches = keywords.filter(kw => cardText.includes(kw)).length;
      score += (matches / keywords.length) * 0.5;
    }

    // 2. position suit weighting
    const POSITION_SUITS = {
      past: ['sword-of-self', 'seed-of-growth'],
      present: ['compass-of-method', 'ship-of-action'],
      future: ['mirror-of-world', 'seed-of-growth']
    };
    if (position && POSITION_SUITS[position]?.includes(card.suit)) {
      score += 0.3;
    }

    // 3. arcana weighting
    if (card.arcana === 'major') score += 0.1;
    if (card.arcana === 'court') score += 0.05;

    // 4. time decay (avoid repeats)
    const last = cardHistory[card.id]?.lastDrawn;
    if (last) {
      const days = (Date.now() - last) / 86400000;
      score += Math.min(days * 0.01, 0.1);
    } else {
      score += 0.05; // never drawn bonus
    }

    return score;
  }

  function drawOne(candidates, excludeIds = new Set()) {
    const pool = candidates.filter(c => !excludeIds.has(c.id));
    if (pool.length === 0) return null;
    // Top 20 random pick
    const topN = Math.min(20, pool.length);
    const idx = Math.floor(Math.random() * topN);
    return pool[idx];
  }

  function recordDraw(cardId) {
    cardHistory[cardId] = {
      lastDrawn: Date.now(),
      count: (cardHistory[cardId]?.count || 0) + 1
    };
    try {
      localStorage.setItem('tarot_history', JSON.stringify(cardHistory));
    } catch {}
  }

  function getDailyPool() {
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const recent = cards.filter(c => new Date(c.mtime).getTime() > sevenDaysAgo);
    return recent.length >= 10 ? recent : cards;
  }

  // ── Spreads ─────────────────────────────────────────────

  function drawSingle(question) {
    const pool = getDailyPool();
    const scored = pool.map(c => ({ card: c, score: scoreCard(c, question, null) }));
    scored.sort((a, b) => b.score - a.score);
    const selected = drawOne(scored.map(s => s.card));
    if (selected) recordDraw(selected.id);
    return selected ? [{ ...selected, position: 'daily', positionName: '日签' }] : [];
  }

  function drawThree(question) {
    const scored = cards.map(c => ({ card: c, score: scoreCard(c, question, null) }));
    scored.sort((a, b) => b.score - a.score);

    const positions = [
      { key: 'past', name: '过去', suits: ['sword-of-self', 'seed-of-growth'] },
      { key: 'present', name: '现在', suits: ['compass-of-method', 'ship-of-action'] },
      { key: 'future', name: '未来', suits: ['mirror-of-world', 'seed-of-growth'] }
    ];

    const drawn = [];
    const exclude = new Set();

    for (const pos of positions) {
      // Try position-suited cards first
      let pool = scored
        .filter(s => pos.suits.includes(s.card.suit) && !exclude.has(s.card.id))
        .map(s => s.card);

      // Fallback: any card if pool too small
      if (pool.length < 5) {
        pool = scored.filter(s => !exclude.has(s.card.id)).map(s => s.card);
      }

      const card = drawOne(pool, exclude);
      if (!card) {
        // ultimate fallback: any card at all
        const fallback = cards.find(c => !exclude.has(c.id));
        if (fallback) {
          drawn.push({ ...fallback, position: pos.key, positionName: pos.name });
          exclude.add(fallback.id);
          recordDraw(fallback.id);
        }
      } else {
        drawn.push({ ...card, position: pos.key, positionName: pos.name });
        exclude.add(card.id);
        recordDraw(card.id);
      }
    }

    return drawn;
  }

  function getStats() {
    const suits = {};
    const types = {};
    const arcanas = {};
    cards.forEach(c => {
      suits[c.suitName] = (suits[c.suitName] || 0) + 1;
      types[c.typeLabel] = (types[c.typeLabel] || 0) + 1;
      arcanas[c.arcana] = (arcanas[c.arcana] || 0) + 1;
    });
    return { total: cards.length, suits, types, arcanas };
  }

  return {
    load,
    getCards,
    getMeta,
    drawSingle,
    drawThree,
    getStats,
    scoreCard
  };
})();
