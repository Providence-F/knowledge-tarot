const fs = require('fs');
const path = require('path');
const {
  compactLine,
  createCard,
  createDeck,
  extractQuotedOrClaim,
  makeJudgment,
  shortTitle,
  stripMarkdown,
  writeJSON
} = require('./lib/curated-card');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'cards.json');
const OUT = path.join(ROOT, 'data', 'seed-decks', 'kai-vault-250.json');
const TARGET = 250;

const FOLDER_WEIGHTS = {
  '03-方法论': 5,
  '02-世界观': 5,
  '01-身份': 5,
  '04-项目': 4,
  '05-学习产出': 4,
  '06-成长': 3,
  '09-收件箱': 1,
  '10-归档': -2,
  '00-元数据': -4,
  '11-系统': -5
};

function loadCards() {
  const json = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
  return Array.isArray(json) ? json : (json.cards || []);
}

function folderOf(card) {
  return String(card.path || '').split('/')[0] || 'unknown';
}

function score(card) {
  const text = `${card.title || ''}\n${card.summary || ''}\n${card.scenario || ''}\n${card.passage || ''}`;
  let s = 0;
  s += FOLDER_WEIGHTS[folderOf(card)] || 0;
  if (/(洞察|概念|方法|框架|复盘|判断|原则|策略|系统|本质)/.test(card.title || card.filename || '')) s += 6;
  if (/核心主张|核心判断|本质|不是|关键|真正|决定|意味着|反常识|取决于/.test(text)) s += 7;
  if (/我|自己|个人|职业|产品|AI|Agent|创业|心理|知识库|一人公司|作品集/.test(text)) s += 4;
  if (Array.isArray(card.keyInsights) && card.keyInsights.length) s += Math.min(6, card.keyInsights.length * 2);
  if (card.summary && card.summary.length >= 14) s += 3;
  if (card.scenario && card.scenario.length >= 8) s += 2;
  if ((card.wordCount || 0) > 250) s += 2;
  if ((card.wordCount || 0) > 8000) s -= 5;
  if (/模板|规范|README|CLAUDE|索引|目录|TEMPLATE|日报|周报/.test(card.title || card.path || '')) s -= 8;
  if (!card.passage || stripMarkdown(card.passage).length < 40) s -= 8;
  if (/^[\s\S]{0,80}$/.test(stripMarkdown(card.passage || ''))) s -= 3;
  return s;
}

function dedupeKey(card) {
  const base = `${card.title || card.filename || ''}`.replace(/[\s\-—_：:｜|]/g, '').slice(0, 18);
  return base || card.id;
}

function cleanTopic(text) {
  return compactLine(String(text || '未命名笔记')
    .replace(/^洞察-|^概念-|^方法-|^框架-|^人物-|^项目-/, '')
    .replace(/[：:｜|].*$/, '')
    .replace(/——.*$/, '')
    .trim(), 22);
}

function splitInsightCandidates(text) {
  return stripMarkdown(text)
    .split(/\n+|。|！|？|；/)
    .map(s => s.replace(/^[-*\d.、\s]+/, '').trim())
    .filter(s => s.length >= 10 && s.length <= 90)
    .filter(s => !/核心主张$|版本一|版本二|节目信息|整理日期|主持人|嘉宾/.test(s));
}

function bestJudgment(card) {
  const fields = [
    card.summary,
    ...(Array.isArray(card.keyInsights) ? card.keyInsights : []),
    card.scenario,
    card.passage
  ].filter(Boolean);
  const candidates = splitInsightCandidates(fields.join('\n'));
  const scored = candidates.map(text => {
    let s = 0;
    if (/不是|本质|关键|真正|核心|取决于|意味着|决定|暴露|稀缺|壁垒/.test(text)) s += 6;
    if (/AI|产品|职业|知识|个人|自己|系统|判断|决策|创业|心理|用户/.test(text)) s += 3;
    if (/，|但|而是|不是/.test(text)) s += 2;
    if (/首先|其次|最后|以下|建议|可以通过|推荐/.test(text)) s -= 5;
    if (text.length > 48) s -= 2;
    return { text, s };
  }).sort((a, b) => b.s - a.s);
  return compactLine((scored[0] && scored[0].text) || makeJudgment(fields.join('\n'), card.title), 58).replace(/^[:：\s]+/, '');
}

function buildPassage(card, judgment) {
  const topic = cleanTopic(card.title || card.filename);
  const source = card.path ? `《${topic}》｜${card.path}` : `《${topic}》`;
  const anchor = compactLine(card.summary || extractQuotedOrClaim(card.passage) || card.scenario || topic, 86).replace(/^[:：\s]+/, '');
  const scenario = compactLine(card.scenario || '', 70);
  const lines = [source, '', anchor];
  if (scenario && scenario !== anchor && !anchor.includes(scenario)) lines.push('', scenario);
  if (judgment && judgment !== anchor) lines.push('', judgment);
  return lines.join('\n');
}

function toCurated(card, idx) {
  const judgment = bestJudgment(card);
  const topic = cleanTopic(card.title || card.filename);
  const title = `${topic}：${shortTitle(judgment, 16)}`;
  const folder = folderOf(card);
  const contentType = /(复盘|案例|行业|竞争|战略|分析|报告)/.test(card.title || card.path || '') ? 'analysis' : 'reflection';
  const summary = `${topic}把 ${folder} 里的一个判断推到台前：${judgment}`;
  const tags = ['kai-vault', folder, ...(card.tags || [])].slice(0, 8);
  return createCard({
    slug: 'kai-vault-250',
    idx,
    contentType,
    title,
    summary,
    passage: buildPassage(card, judgment),
    tags,
    source: { type: 'obsidian', path: card.path || null, label: 'AI革命生存指南' },
    createdAt: Date.parse(card.ctime || card.mtime || '') || Date.now() + idx,
    suitSeed: `${folder}:${title}`
  });
}

function selectCards(cards) {
  const sorted = cards
    .map(card => ({ card, score: score(card), key: dedupeKey(card) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const selected = [];
  const folderCounts = new Map();

  for (const item of sorted) {
    if (selected.length >= TARGET) break;
    if (seen.has(item.key)) continue;
    const folder = folderOf(item.card);
    const count = folderCounts.get(folder) || 0;
    const softCap = folder === '03-方法论' ? 75 : folder === '02-世界观' ? 55 : folder === '04-项目' ? 45 : folder === '01-身份' ? 35 : 30;
    if (count >= softCap) continue;
    selected.push(item.card);
    seen.add(item.key);
    folderCounts.set(folder, count + 1);
  }

  if (selected.length < TARGET) {
    for (const item of sorted) {
      if (selected.length >= TARGET) break;
      if (selected.includes(item.card) || seen.has(item.key)) continue;
      selected.push(item.card);
      seen.add(item.key);
    }
  }

  return selected.slice(0, TARGET);
}

function main() {
  const sourceCards = loadCards();
  const selected = selectCards(sourceCards);
  if (selected.length !== TARGET) throw new Error(`expected ${TARGET}, got ${selected.length}`);
  const cards = selected.map(toCurated);
  const deck = createDeck({
    slug: 'kai-vault-250',
    name: 'AI革命生存指南精选',
    description: '从 Kai 的 Obsidian 知识库中严格筛选出的 250 张判断卡。',
    emoji: '🧭',
    cards,
    lastImportSource: 'curate-kai-vault-deck'
  });
  writeJSON(OUT, deck);
  const dist = cards.reduce((acc, c) => {
    const k = c.tags[1] || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${OUT}`);
  console.log(JSON.stringify({ total: cards.length, dist, first: cards[0].title }, null, 2));
}

main();
