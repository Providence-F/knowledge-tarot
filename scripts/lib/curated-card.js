const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SUITS = [
  ['seed-of-growth', '成长之种'],
  ['mirror-of-world', '世界之镜'],
  ['blade-of-truth', '真相之刃'],
  ['cup-of-memory', '记忆之杯']
];

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.join(':')).digest('base64url').slice(0, 8).toLowerCase();
}

function pickSuit(seed) {
  const text = String(seed || '');
  let n = 0;
  for (let i = 0; i < text.length; i++) n = ((n << 5) - n) + text.charCodeAt(i);
  return SUITS[Math.abs(n) % SUITS.length];
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^[#>\-*>\s]+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactLine(text, max = 80) {
  const line = stripMarkdown(text).replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('，'), cut.lastIndexOf('；'), cut.lastIndexOf('：'));
  return (stop > max * 0.55 ? cut.slice(0, stop) : cut).trim();
}

function firstSentence(text, max = 90) {
  const clean = stripMarkdown(text).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const m = clean.match(/^(.{8,}?[。！？；])/);
  return compactLine(m ? m[1] : clean, max);
}

function shortTitle(text, max = 16) {
  const clean = compactLine(text, 60).replace(/[。！？；].*$/, '').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max);
}

function removeServerBusy(text) {
  return String(text || '')
    .split(/\n+/)
    .filter(line => !/服务器繁忙|请稍后再试/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractQuotedOrClaim(text) {
  const clean = stripMarkdown(removeServerBusy(text));
  const quote = clean.match(/[“\"]([^”\"]{8,80})[”\"]/);
  if (quote) return quote[1].trim();
  const lines = clean.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const scored = lines
    .filter(line => line.length >= 10 && line.length <= 120)
    .filter(line => /不是|本质|核心|关键|真正|如果|需要|应该|决定|意味着|暴露|形成|导致|来自|取决于/.test(line))
    .sort((a, b) => scoreInsightLine(b) - scoreInsightLine(a));
  return scored[0] || firstSentence(clean, 90);
}

function scoreInsightLine(line) {
  let score = 0;
  if (/不是|本质|核心|关键|真正/.test(line)) score += 4;
  if (/但|而是|却|反而|同时/.test(line)) score += 2;
  if (/我|自己|个人|用户|产品|AI|职业|心理|系统|判断|决策/.test(line)) score += 2;
  if (line.length >= 18 && line.length <= 70) score += 2;
  if (/首先|其次|最后|综上|总之|值得注意/.test(line)) score -= 4;
  return score;
}

function makeJudgment(text, fallback) {
  const claim = extractQuotedOrClaim(text || fallback || '');
  if (!claim) return compactLine(fallback || '真正重要的内容，会留下可迁移的判断。', 60);
  return claim.replace(/^核心主张[:：]?\s*/, '').replace(/^结论[:：]?\s*/, '').trim();
}

function createCard({ slug, idx, contentType = 'reflection', title, summary, passage, tags = [], source = {}, createdAt, suitSeed }) {
  const [suit, suitName] = pickSuit(suitSeed || title || idx);
  const now = Date.now();
  return {
    id: stableId(slug, idx, title),
    contentType,
    title: compactLine(title, 56),
    summary: compactLine(summary, 120),
    passage: stripMarkdown(passage),
    fullPassage: stripMarkdown(passage),
    insights: null,
    suit,
    suitName,
    source: {
      type: source.type || 'seed',
      path: source.path || null,
      label: source.label || slug,
      url: source.url || undefined,
      originalCardId: source.originalCardId || undefined,
      originalDeckId: source.originalDeckId || undefined
    },
    createdAt: createdAt || now + idx,
    tags: Array.from(new Set(tags.filter(Boolean)))
  };
}

function createDeck({ slug, name, description, emoji, cards, ownerId = 'system', visibility = 'system-readonly', lastImportSource = 'curated-offline-script' }) {
  const now = Date.now();
  return {
    id: slug.startsWith('seed-') ? slug : `seed-${slug}`,
    slug,
    ownerId,
    name,
    description,
    emoji,
    visibility,
    createdAt: now,
    updatedAt: now,
    totalCards: cards.length,
    lastImport: { source: lastImportSource, at: now, strategy: 'curated-structured-cards' },
    cards
  };
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  stableId,
  pickSuit,
  stripMarkdown,
  compactLine,
  firstSentence,
  shortTitle,
  removeServerBusy,
  extractQuotedOrClaim,
  makeJudgment,
  createCard,
  createDeck,
  writeJSON
};
