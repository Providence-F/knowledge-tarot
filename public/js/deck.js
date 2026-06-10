// deck.js — Deck logic module (ES module)

const STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '有', '不', '这', '我', '你', '他', '她', '它', '们',
  '那', '就', '也', '都', '把', '被', '让', '给', '从', '到', '与', '或', '但', '而',
  '如果', '因为', '所以', '可以', '已经', '一个', '什么',
]);

const POSITION_SUIT_MAP = {
  '过去': ['sword-of-self', 'seed-of-growth'],
  '现在': ['compass-of-method', 'ship-of-action'],
  '未来': ['mirror-of-world', 'seed-of-growth'],
};

/**
 * Load the full deck from the API.
 */
export async function loadDeck() {
  const res = await fetch('/api/cards');
  if (!res.ok) throw new Error(`Failed to load cards: ${res.status}`);
  return res.json();
}

/**
 * Simple Chinese keyword extraction.
 */
export function extractKeywords(text) {
  if (!text) return [];
  // Split by punctuation and whitespace
  const tokens = text
    .split(/[，。！？、；：""''（）\s\.\!\?\,\;\:\"\'\(\)]+/)
    .filter(t => t.length > 0);

  const keywords = [];
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    if (token.length >= 1 && token.length <= 4) {
      keywords.push(token);
    }
  }
  return [...new Set(keywords)];
}

/**
 * Score a card for relevance to the question keywords and position.
 */
export function scoreCard(card, keywords, position) {
  let score = 0;
  const keywordCount = keywords.length || 1;

  // Keyword match in title / scenario / summary / tags
  const searchText = [
    card.title || '',
    card.scenario || '',
    card.summary || '',
    ...(card.tags || []),
  ].join(' ');

  let matchCount = 0;
  for (const kw of keywords) {
    if (searchText.includes(kw)) matchCount++;
  }
  score += 0.5 * (matchCount / keywordCount);

  // Position suit match
  if (position && POSITION_SUIT_MAP[position]) {
    if (POSITION_SUIT_MAP[position].includes(card.suit)) {
      score += 0.3;
    }
  }

  // Arcana bonus
  if (card.arcana === 'major') score += 0.1;
  else if (card.arcana === 'court') score += 0.05;

  // Time decay from localStorage history
  const history = getDrawHistory();
  const lastDraw = history[card.id];
  if (lastDraw) {
    const daysSince = (Date.now() - lastDraw) / (1000 * 60 * 60 * 24);
    score += Math.min(daysSince * 0.01, 0.1);
  }

  return score;
}

/**
 * Main draw function.
 */
export function drawCards(deck, question, spreadType) {
  const keywords = extractKeywords(question);
  const allCards = deck.cards || deck;

  if (spreadType === 'single') {
    // Score all cards, take top 20, randomly pick 1
    const scored = allCards
      .map(c => ({ card: c, score: scoreCard(c, keywords, null) }))
      .sort((a, b) => b.score - a.score);

    const pool = scored.slice(0, 20);
    const picked = pool[Math.floor(Math.random() * pool.length)];
    updateDrawHistory([picked.card.id]);
    return [{ ...picked.card, position: '今日' }];
  }

  // Three-card spread
  const positions = ['过去', '现在', '未来'];
  const drawn = [];

  for (const pos of positions) {
    const candidates = allCards
      .filter(c => !drawn.some(d => d.id === c.id))
      .map(c => ({ card: c, score: scoreCard(c, keywords, pos) }))
      .sort((a, b) => b.score - a.score);

    // Pool exhaustion protection: relax suit filter if < 5 candidates
    let pool = candidates.slice(0, 20);
    if (pool.length < 5) {
      pool = candidates; // use all remaining
    }

    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (picked) {
      drawn.push({ ...picked.card, position: pos });
    }
  }

  updateDrawHistory(drawn.map(c => c.id));
  return drawn;
}

/**
 * Get draw history from localStorage.
 */
export function getDrawHistory() {
  try {
    const raw = localStorage.getItem('knowledge-tarot-history');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save draw history to localStorage.
 */
export function saveDrawHistory(history) {
  try {
    localStorage.setItem('knowledge-tarot-history', JSON.stringify(history));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Update draw history with newly drawn card IDs.
 */
function updateDrawHistory(cardIds) {
  const history = getDrawHistory();
  const now = Date.now();
  for (const id of cardIds) {
    history[id] = now;
  }
  saveDrawHistory(history);
}
