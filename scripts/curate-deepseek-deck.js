const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  compactLine,
  createCard,
  createDeck,
  removeServerBusy,
  shortTitle,
  stripMarkdown,
  writeJSON
} = require('./lib/curated-card');

const ROOT = path.join(__dirname, '..');
const USER_ID = '5af775a3739b22f22194d19db746f96e';
const SOURCE_DECK_ID = 'a00abf2b7904';
const NEW_DECK_ID = 'd55e9e250250';
const SRC = path.join(ROOT, 'data', 'users', USER_ID, 'decks', `${SOURCE_DECK_ID}.json`);
const OUT = path.join(ROOT, 'data', 'users', USER_ID, 'decks', `${NEW_DECK_ID}.json`);
const PROFILE = path.join(ROOT, 'data', 'users', USER_ID, 'profile.json');
const TARGET = 250;

const TOPIC_RULES = [
  [/心理|荣格|阿德勒|弗洛伊德|自卑|人格|MBTI|内向|创伤|潜意识|共时性/, '心理'],
  [/产品|用户|需求|PRD|原型|体验|功能|交互|竞品|PM|增长/, '产品'],
  [/AI|Agent|模型|提示词|大模型|DeepSeek|Kimi|Claude|ChatGPT|自动化/, 'AI产品'],
  [/职业|实习|简历|作品集|面试|管培生|求职|能力|一人公司/, '职业'],
  [/创业|商业|公司|融资|战略|壁垒|组织|管理|品牌/, '商业'],
  [/读书|笔记|知识库|Obsidian|写作|内容|公众号|小红书/, '知识管理'],
  [/历史|文明|社会|国家|政治|经济|心理史学|阿西莫夫|基地/, '世界观'],
  [/设计|视觉|封面|海报|网站|页面|UI|色彩/, '表达']
];

function loadDeck() {
  return JSON.parse(fs.readFileSync(SRC, 'utf-8'));
}

function topicOf(card) {
  const q = `${card.title || ''}\n${userQuestion(card)}`;
  for (const [re, name] of TOPIC_RULES) if (re.test(q)) return name;
  const text = `${card.summary || ''}\n${card.passage || ''}`.slice(0, 1200);
  for (const [re, name] of TOPIC_RULES) if (re.test(text)) return name;
  return '思考';
}

function userQuestion(card) {
  const text = removeServerBusy(card.fullPassage || card.passage || '');
  const matches = [...text.matchAll(/我：([^\n]{4,180})/g)].map(m => m[1].trim());
  if (matches.length) return matches.sort((a, b) => b.length - a.length)[0];
  return card.title || '';
}

function aiClaims(card) {
  const text = stripMarkdown(removeServerBusy(card.fullPassage || card.passage || ''));
  const claims = [];
  if (card.summary) claims.push(card.summary);
  if (Array.isArray(card.insights)) claims.push(...card.insights);
  claims.push(...text
    .split(/\n+|。|！|？|；/)
    .map(s => s.replace(/^[-*\d.、#\s]+/, '').trim())
    .filter(s => s.length >= 12 && s.length <= 100)
    .filter(s => !/^我：|^AI：|服务器繁忙|以下是|总结|建议|可以|如果你|希望|一、|二、|三、|四、|五、/.test(s)));
  return claims;
}

function scoreClaim(line) {
  let s = 0;
  if (/不是|本质|核心|关键|真正|决定|取决于|意味着|暴露|区别|优势|陷阱/.test(line)) s += 7;
  if (/AI|产品|用户|心理|职业|知识|系统|能力|商业|社会|历史|个人/.test(line)) s += 3;
  if (/但|而是|不是|却|反而/.test(line)) s += 2;
  if (/材料|步骤|清单|物料|代码|安装|参数|平台|链接/.test(line)) s -= 4;
  if (line.length > 65) s -= 2;
  return s;
}

function bestClaim(card) {
  const direct = compactLine(card.summary || '', 58);
  if (direct && !/^(这是一段|以下是|一、|二、|三、|关键词推荐|意义：|由来：)/.test(direct)) return direct;
  if (Array.isArray(card.insights) && card.insights.length) {
    const insight = card.insights.map(x => compactLine(x, 58)).find(x => x && !/材料|步骤|清单|关键词推荐/.test(x));
    if (insight) return insight;
  }
  const claims = aiClaims(card).map(text => ({ text, score: scoreClaim(text) })).sort((a, b) => b.score - a.score);
  const top = claims[0]?.text || userQuestion(card) || card.title || '问题真正暴露的不是答案，而是判断模型';
  return compactLine(top.replace(/^核心[:：]?\s*/, '').replace(/^结论[:：]?\s*/, '').replace(/^意义[:：]?\s*/, ''), 58);
}

function scoreCard(card) {
  const text = `${card.title || ''}\n${card.summary || ''}\n${card.fullPassage || card.passage || ''}`;
  const cleaned = removeServerBusy(text);
  let s = 0;
  const busyCount = (text.match(/服务器繁忙/g) || []).length;
  s -= busyCount * 4;
  if (busyCount >= 3) s -= 12;
  if (card.summary && card.summary.length >= 12) s += 18;
  if (Array.isArray(card.insights) && card.insights.length) s += 12;
  if (/(心理|荣格|阿德勒|产品|AI|Agent|职业|作品集|知识库|创业|商业|历史|文明|一人公司)/.test(text)) s += 8;
  if (/(本质|核心|关键|不是|真正|决定|取决于|意味着|判断|方法论|框架)/.test(text)) s += 7;
  if ((cleaned.match(/我：/g) || []).length >= 1) s += 4;
  if ((cleaned.match(/我：/g) || []).length >= 3) s += 3;
  if (cleaned.length >= 180 && cleaned.length <= 5000) s += 4;
  if (cleaned.length > 9000) s -= 6;
  if (/(胸部|气质类型|胆汁质|多血质|音乐治疗|动物比喻|名字背后|单音节名|键盘|练琴|圣女果|酒吧|夜店|低成本高频率|校内社交)/.test(text)) s -= 22;
  if (/^(这是一段|以下是|一、|二、|三、|关键词推荐|意义：|由来：|主题：|名字背后|社交媒体|低热量)/.test(bestClaim(card))) s -= 18;
  if (/(物料|制作|电池|铜线|食材|旅游|翻译|代码|报错|安装|API key|服务器配置|热量|酒吧|夜店|键盘|练琴|圣女果|菜谱|清单)/.test(text)) s -= 18;
  if (/^(什么是|请问|帮我推荐|有哪些|如何|怎么)/.test(card.title || '')) s -= 4;
  if (!cleaned || cleaned.length < 80) s -= 20;
  return s;
}

function dedupeKey(card) {
  const q = userQuestion(card) || card.title || '';
  return q.replace(/[\s，。！？；：:、"“”《》]/g, '').slice(0, 24);
}

function buildPassage(card, topic, question, claim) {
  const source = `DeepSeek 对话｜${new Date(card.createdAt || Date.now()).toISOString().slice(0, 10)}`;
  const q = compactLine(question, 86);
  const lines = [source, '', `我问：${q}`];
  if (claim && claim !== q) lines.push('', claim);
  return lines.join('\n');
}

function toCurated(card, idx) {
  const topic = topicOf(card);
  const question = userQuestion(card);
  const claim = bestClaim(card);
  const title = `${topic}：${shortTitle(claim, 18)}`;
  const summary = `${topic}对话把一个真实问题推到台前：${claim}`;
  const contentType = /(产品|AI产品|商业|世界观)/.test(topic) ? 'analysis' : 'reflection';
  return createCard({
    slug: 'deepseek-250',
    idx,
    contentType,
    title,
    summary,
    passage: buildPassage(card, topic, question, claim),
    tags: ['deepseek-curated', topic, ...(card.tags || [])].slice(0, 8),
    source: {
      type: 'deepseek',
      label: 'DeepSeek 对话精选',
      originalCardId: card.id,
      originalDeckId: SOURCE_DECK_ID
    },
    createdAt: card.createdAt || Date.now() + idx,
    suitSeed: `${topic}:${title}`
  });
}

function select(cards) {
  const sorted = cards
    .map(card => ({ card, score: scoreCard(card), key: dedupeKey(card), topic: topicOf(card) }))
    .filter(x => x.score > 0 && x.key)
    .sort((a, b) => b.score - a.score);
  const caps = { 'AI产品': 45, '产品': 45, '心理': 40, '职业': 35, '知识管理': 35, '商业': 25, '世界观': 25, '表达': 18, '思考': 35 };
  const minimums = { '心理': 18, '产品': 28, 'AI产品': 28, '职业': 12, '知识管理': 16, '世界观': 10 };
  const counts = {};
  const seen = new Set();
  const picked = [];

  for (const topic of Object.keys(minimums)) {
    for (const item of sorted.filter(x => x.topic === topic)) {
      if ((counts[topic] || 0) >= minimums[topic]) break;
      if (seen.has(item.key)) continue;
      picked.push(item.card);
      seen.add(item.key);
      counts[topic] = (counts[topic] || 0) + 1;
    }
  }

  for (const item of sorted) {
    if (picked.length >= TARGET) break;
    if (seen.has(item.key)) continue;
    const cap = caps[item.topic] || 30;
    if ((counts[item.topic] || 0) >= cap) continue;
    picked.push(item.card);
    seen.add(item.key);
    counts[item.topic] = (counts[item.topic] || 0) + 1;
  }
  for (const item of sorted) {
    if (picked.length >= TARGET) break;
    if (picked.includes(item.card) || seen.has(item.key)) continue;
    picked.push(item.card);
    seen.add(item.key);
  }
  return { picked: picked.slice(0, TARGET), counts };
}

function updateProfile() {
  const profile = JSON.parse(fs.readFileSync(PROFILE, 'utf-8'));
  profile.ownedDeckIds = Array.from(new Set([...(profile.ownedDeckIds || []), NEW_DECK_ID]));
  profile.activeDeckId = NEW_DECK_ID;
  fs.writeFileSync(PROFILE, JSON.stringify(profile, null, 2));
}

function main() {
  const source = loadDeck();
  const { picked } = select(source.cards || []);
  if (picked.length !== TARGET) throw new Error(`expected ${TARGET}, got ${picked.length}`);
  const cards = picked
    .map(card => ({ card, score: scoreCard(card) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.card)
    .map(toCurated);
  const now = Date.now();
  const deck = {
    ...createDeck({
      slug: 'deepseek-250',
      name: 'DeepSeek 对话精选 250',
      description: '从 720 张历史对话卡中严格筛选并重写，保留原始牌堆不覆盖。',
      emoji: '🧠',
      cards,
      ownerId: USER_ID,
      visibility: 'private',
      lastImportSource: 'curate-deepseek-deck'
    }),
    id: NEW_DECK_ID,
    ownerId: USER_ID,
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
    lastImport: {
      source: 'curate-deepseek-deck',
      at: now,
      sourceDeckId: SOURCE_DECK_ID,
      sourceCards: (source.cards || []).length,
      selectedCards: cards.length,
      strategy: 'strict-filter-and-rewrite'
    }
  };
  writeJSON(OUT, deck);
  updateProfile();
  const dist = cards.reduce((acc, c) => {
    const k = c.tags[1] || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${OUT}`);
  console.log(JSON.stringify({ total: cards.length, dist, first: cards[0].title }, null, 2));
}

main();
