const STOPWORDS = new Set([
  '的', '是', '在', '了', '和', '与', '或', '但', '而', '把', '被', '让', '给',
  '从', '到', '对于', '关于', '通过', '经过', '因为', '所以', '如果', '虽然',
  '但是', '可以', '能够', '应该', '需要', '已经', '正在', '将要', '这个', '那个',
  '什么', '怎么', '为什么', '一个', '一些', '我们', '你们', '他们', '自己',
  '没有', '不是', '就是', '还是', '可能', '应该',
]);

const POSITION_CONFIG = {
  past: { suits: ['sword-of-self', 'seed-of-growth'], label: '过去' },
  present: { suits: ['compass-of-method', 'ship-of-action'], label: '现在' },
  future: { suits: ['mirror-of-world', 'seed-of-growth'], label: '未来' },
};

export async function loadDeck(url = '/data/cards.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load deck: ${res.status}`);
  return res.json();
}

export function drawDaily(cards) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const recent = cards.filter(c => {
    const ts = c.metadata?.created || c.metadata?.updated;
    if (!ts) return false;
    return new Date(ts).getTime() >= sevenDaysAgo;
  });

  const pool = recent.length > 0 ? recent : cards;
  const scored = pool.map(c => ({ card: c, score: scoreCard(c, '', null) }));
  return selectFromCandidates(scored, 1)[0] || null;
}

export function drawThree(cards, question) {
  const usedIds = new Set();
  const positions = ['past', 'present', 'future'];
  const result = [];

  for (const pos of positions) {
    const available = getAvailableCards(cards, usedIds);
    const scored = available.map(c => ({ card: c, score: scoreCard(c, question, pos) }));
    const picked = selectFromCandidates(scored, 1);
    if (picked.length > 0) {
      usedIds.add(picked[0].id);
      result.push({ ...picked[0], position: pos, positionLabel: POSITION_CONFIG[pos].label });
    }
  }

  updateDrawHistory(result.map(c => c.id));
  return result;
}

function scoreCard(card, question, position) {
  let score = 0;

  const keywords = extractKeywords(question);
  if (keywords.length > 0) {
    const searchText = [
      card.title || '',
      card.scenario || '',
      card.summary || '',
      ...(card.tags || []),
      ...(card.keywords || []),
    ].join(' ');
    const textKeywords = extractKeywords(searchText);
    const intersection = keywords.filter(k => textKeywords.some(t => t.includes(k) || k.includes(t)));
    const union = new Set([...keywords, ...textKeywords]);
    score += 0.5 * (union.size > 0 ? intersection.length / union.size : 0);
  }

  if (position && POSITION_CONFIG[position]) {
    if (POSITION_CONFIG[position].suits.includes(card.suit)) {
      score += 0.3;
    }
  }

  if (card.arcana === 'major') score += 0.1;
  else if (card.arcana === 'court') score += 0.05;

  const history = getDrawHistory();
  const lastDraw = history[card.id];
  if (lastDraw) {
    const days = (Date.now() - lastDraw) / (1000 * 60 * 60 * 24);
    score += Math.min(days * 0.01, 0.1);
  }

  return score;
}

function extractKeywords(text) {
  if (!text) return [];
  return text
    .split(/[，。！？、；：""''（）\s.!?,:;'"()\[\]{}]+/)
    .filter(t => t.length >= 1 && t.length <= 8 && !STOPWORDS.has(t));
}

function selectFromCandidates(scoredCards, count) {
  const sorted = scoredCards.sort((a, b) => b.score - a.score);
  const top20 = sorted.slice(0, 20);
  const result = [];
  const pool = [...top20];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool[idx].card);
    pool.splice(idx, 1);
  }

  return result;
}

function getAvailableCards(cards, usedIds = new Set(), suitFilter = null) {
  let pool = cards.filter(c => !usedIds.has(c.id));
  if (suitFilter) {
    const filtered = pool.filter(c => suitFilter.includes(c.suit));
    if (filtered.length >= 3) pool = filtered;
  }
  if (pool.length < 3) pool = cards.filter(c => !usedIds.has(c.id));
  return pool;
}

function getDrawHistory() {
  try {
    const raw = localStorage.getItem('cardHistory');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function updateDrawHistory(cardIds) {
  const history = getDrawHistory();
  const now = Date.now();
  for (const id of cardIds) history[id] = now;
  try {
    localStorage.setItem('cardHistory', JSON.stringify(history));
  } catch {}
}
