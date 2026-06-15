/**
 * src/pipeline.js — 编排 Layer 1 → Layer 2 → Layer 3
 *
 * M0 版：sources 只有 obsidian / textdump；extractor 只有 regex；classifier 只有 path-rule。
 * 行为目标：用 Kai 的 Obsidian vault 跑出来的牌堆，与原 build-deck.js 输出字段等价。
 */

const fs = require('fs');
const path = require('path');

const obsidian = require('./adapters/obsidian');
const textdump = require('./adapters/textdump');
const regexExtractor = require('./extractors/regex');
const pathRule = require('./classifiers/path-rule');

const ADAPTERS = {
  obsidian: input => obsidian.loadFromVault(input.path, input.options),
  textdump: input => input.text != null
    ? textdump.loadFromText(input.text, input.label)
    : textdump.loadFromPath(input.path)
};

/**
 * @param {object} opts
 * @param {'obsidian'|'textdump'} opts.source
 * @param {object} opts.input  传给 adapter 的原始入参
 * @returns {{cards: array, stats: object}}
 */
function runPipeline(opts) {
  const adapter = ADAPTERS[opts.source];
  if (!adapter) throw new Error(`Unknown source: ${opts.source}`);

  const stats = {
    totalItems: 0,
    keptCards: 0,
    droppedNoSuit: 0,
    suitDistribution: {},
    typeDistribution: {},
    arcanaDistribution: {}
  };

  const rawItems = adapter(opts.input);
  stats.totalItems = rawItems.length;

  const cards = [];
  for (const item of rawItems) {
    const suit = pathRule.classify(item);
    if (!suit) {
      stats.droppedNoSuit++;
      continue;
    }
    const fields = regexExtractor.extract(item);
    const fm = item.sourceMeta?.frontmatter || {};
    const filename = item.sourceMeta?.filename || item.title;
    const cardType = pathRule.detectCardType(filename);
    const arcana = pathRule.getArcana(fm.status);

    const card = buildCard(item, fields, suit, cardType, arcana);
    cards.push(card);
    stats.keptCards++;
    stats.suitDistribution[suit.suitId] = (stats.suitDistribution[suit.suitId] || 0) + 1;
    stats.typeDistribution[cardType.type] = (stats.typeDistribution[cardType.type] || 0) + 1;
    stats.arcanaDistribution[arcana] = (stats.arcanaDistribution[arcana] || 0) + 1;
  }

  cards.sort((a, b) => {
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
    return a.title.localeCompare(b.title);
  });

  return { cards, stats };
}

function buildCard(item, fields, suit, cardType, arcana) {
  const fm = item.sourceMeta?.frontmatter || {};
  const tags = item.tags || [];
  return {
    id: item.sourceMeta?.path
      ? item.sourceMeta.path.replace(/[\\/]/g, '-').replace(/\.md$/, '')
      : item.id,
    title: fields.title.slice(0, 200),
    filename: item.sourceMeta?.filename || item.title,
    path: item.sourceMeta?.path || '',
    suit: suit.suitId,
    suitName: suit.suitName,
    type: cardType.type,
    typeLabel: cardType.label,
    arcana,
    summary: fields.summary,
    scenario: fields.scenario,
    passage: fields.passage,
    keyInsights: fields.keyInsights,
    structuredSections: fields.structuredSections,
    tags,
    wikilinks: extractWikilinksFrom(item),
    status: fm.status || 'seed',
    date: fm.date || null,
    private: fm.private === true || fm.private === 'true',
    mtime: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
    ctime: item.createdAt ? new Date(item.createdAt).toISOString() : null,
    wordCount: (item.body || '').replace(/\s/g, '').length
  };
}

function extractWikilinksFrom(item) {
  const c = item.sourceMeta?.rawContent || item.body || '';
  const links = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = re.exec(c)) !== null) links.push(m[1].trim());
  return [...new Set(links)];
}

function writeDeck(cards, sourcePath, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      sourcePath,
      totalCards: cards.length
    },
    cards
  }, null, 2));
}

module.exports = { runPipeline, writeDeck };

// ── CLI ────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const sourceArg = args.find(a => a.startsWith('--source='))?.slice(9);
  const pathArg = args.find(a => a.startsWith('--path='))?.slice(7);
  const outArg = args.find(a => a.startsWith('--out='))?.slice(6);

  const source = sourceArg || 'obsidian';
  let inputPath = pathArg;
  if (!inputPath && source === 'obsidian') {
    const config = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'config', 'suit-mapping.json'), 'utf-8'
    ));
    inputPath = config.knowledgeBasePath;
  }
  const output = outArg || path.join(__dirname, '..', 'data', 'cards.json');

  console.log(`Source: ${source}`);
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${output}\n`);

  const { cards, stats } = runPipeline({
    source,
    input: { path: inputPath }
  });
  writeDeck(cards, inputPath, output);

  console.log('=== 知识塔罗构建报告（pipeline v2 / M0）===');
  console.log(`  扫描 RawItem: ${stats.totalItems}`);
  console.log(`  入牌堆: ${stats.keptCards}`);
  console.log(`  因不属于五花色被丢弃: ${stats.droppedNoSuit}`);
  console.log('\n花色分布:');
  Object.entries(stats.suitDistribution).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log('\n牌型分布:');
  Object.entries(stats.typeDistribution).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log('\n牌位分布:');
  Object.entries(stats.arcanaDistribution).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log(`\n输出: ${output} (${(fs.statSync(output).size / 1024).toFixed(1)} KB)`);
}
