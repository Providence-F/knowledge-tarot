const path = require('path');
const {
  createCard,
  createDeck,
  stableId,
  stripMarkdown,
  writeJSON
} = require('./lib/curated-card');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'seed-decks', 'pmthinking-links.json');
const BASE = 'https://read.pmthinking.com/';
const HOME = 'https://pmthinking.com/';
const MAX_PAGES = 800;

function normalizeUrl(href, base = BASE) {
  try {
    const u = new URL(href, base);
    if (!['pmthinking.com', 'read.pmthinking.com'].includes(u.hostname)) return null;
    u.hash = '';
    u.search = '';
    const s = u.toString().replace(/\/$/, '/');
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|ico|pdf|zip)$/i.test(s)) return null;
    if (/\/_next\/|\/tag\/|\/category\/|\/author\/|\/page\/|\/feed\/?$|\/sitemap|\/manifest/.test(u.pathname)) return null;
    return s;
  } catch {
    return null;
  }
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .trim();
}

function extractSitemapUrls(xml) {
  const urls = new Set();
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const u = normalizeUrl(decodeEntities(m[1]), BASE);
    if (u) urls.add(u);
  }
  return [...urls];
}

function extractNextDataUrls(html) {
  const urls = new Set();
  const re = /(?:\"|')\/(p\/\d+)(?:\"|')/g;
  let m;
  while ((m = re.exec(html))) {
    const u = normalizeUrl(`/${m[1]}`, BASE);
    if (u) urls.add(u);
  }
  return [...urls];
}

function extractLinks(html, base) {
  const links = new Set();
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = normalizeUrl(m[1], base);
    if (u) links.add(u);
  }
  return [...links];
}

function extractTitle(html) {
  const og = html.match(/<meta\s+[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (og) return cleanupTitle(og[1]);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return cleanupTitle(title[1]);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return cleanupTitle(h1[1]);
  return '';
}

function cleanupTitle(title) {
  return decodeEntities(stripMarkdown(String(title || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')))
    .replace(/\s*[|-]\s*产品沉思录\s*$/i, '')
    .trim();
}

function looksArticle(url, title) {
  const u = new URL(url);
  if (u.pathname === '/' || !title) return false;
  if (title === '产品沉思录' || title.length < 3) return false;
  if (/登录|注册|归档|标签|分类|关于|搜索|首页|订阅/.test(title)) return false;
  return true;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'KnowledgeTarotLinkIndexer/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

async function crawl() {
  const queue = [BASE, `${BASE}sitemap.xml`, HOME];
  const seen = new Set();
  const articles = new Map();

  while (queue.length && seen.size < MAX_PAGES) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.warn(`[skip] ${e.message}`);
      continue;
    }

    for (const link of extractSitemapUrls(html)) {
      if (!seen.has(link) && queue.length < MAX_PAGES) queue.push(link);
    }

    const title = extractTitle(html);
    if (looksArticle(url, title)) articles.set(url, title);

    for (const link of [...extractLinks(html, url), ...extractNextDataUrls(html)]) {
      if (!seen.has(link) && queue.length < MAX_PAGES) queue.push(link);
    }
  }

  return [...articles.entries()]
    .map(([url, title]) => ({ url, title }))
    .filter(item => /^https:\/\/read\.pmthinking\.com\/p\/\d+\/?$/.test(item.url))
    .sort((a, b) => Number(new URL(a.url).pathname.split('/').pop()) - Number(new URL(b.url).pathname.split('/').pop()));
}

function toCard(item, idx) {
  const passage = [
    `产品沉思录｜原文链接`,
    '',
    item.title,
    '',
    item.url,
    '',
    '这张卡只保存标题和链接，正文以原站为准。'
  ].join('\n');
  return createCard({
    slug: 'pmthinking-links',
    idx,
    contentType: 'reference',
    title: item.title,
    summary: '产品沉思录原文链接卡。点击查看原文。',
    passage,
    tags: ['pmthinking', '产品沉思录'],
    source: { type: 'web-link', label: '产品沉思录', url: item.url },
    createdAt: Date.now() + idx,
    suitSeed: stableId('pmthinking', item.url)
  });
}

async function main() {
  const articles = await crawl();
  if (!articles.length) throw new Error('未解析到文章链接');
  const cards = articles.map(toCard);
  const deck = createDeck({
    slug: 'pmthinking-links',
    name: '产品沉思录索引',
    description: '产品沉思录公开文章的标题与原文链接索引；不复制正文，点击回原站查看。',
    emoji: '📝',
    cards,
    lastImportSource: 'build-pmthinking-link-deck'
  });
  writeJSON(OUT, deck);
  console.log(`Wrote ${OUT}`);
  console.log(JSON.stringify({ total: cards.length, first: cards[0].title }, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
