/**
 * src/pipeline-v2.js — Layer 1→2→3 完整 LLM 流水线
 *
 * 与 src/pipeline.js（M0 版，纯正则）并存：
 *   - pipeline.js（M0）：用于 Kai 自己的 Obsidian 库，行为等价于旧版 build-deck
 *   - pipeline-v2.js（M2+）：用于任意源，全流程 LLM 分诊 + 提炼 + 贴花色
 *
 * 输出 schema：
 *   {
 *     id, contentType, title, summary, passage, insights,
 *     suit, suitName, source, createdAt
 *   }
 *
 * 不再生成 keyInsights / structuredSections / arcana / type 等旧字段。
 */

const obsidian = require('./adapters/obsidian');
const textdump = require('./adapters/textdump');
const { triage } = require('./triager');
const { extractByType } = require('./extractors');
const { paintSuit } = require('./classifiers/suit-painter');
const { hashId } = require('./utils');

const ADAPTERS = {
  obsidian: input => obsidian.loadFromVault(input.path, input.options),
  textdump: input => input.text != null
    ? textdump.loadFromText(input.text, input.label)
    : textdump.loadFromPath(input.path)
};

/**
 * 把一批 RawItem 转成完整的 Card[]
 * @param {RawItem[]} rawItems
 * @param {(progress: object) => void} [onProgress] 进度回调
 * @param {number} [concurrency=6] 并发数
 * @returns {Promise<{cards: Card[], stats: object}>}
 */
async function processItems(rawItems, onProgress, concurrency = 6) {
  const stats = {
    total: rawItems.length,
    kept: 0,
    droppedByCategory: { data: 0, code: 0, other: 0 },
    categoryDist: {},
    suitDist: {}
  };

  const cards = [];
  let nextIdx = 0;
  let processed = 0;

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= rawItems.length) return;
      const item = rawItems[i];

      try {
        const category = await triage(item);
        stats.categoryDist[category] = (stats.categoryDist[category] || 0) + 1;

        if (['data', 'code', 'other'].includes(category)) {
          stats.droppedByCategory[category]++;
          processed++;
          onProgress?.({ stage: 'triage', i: processed, total: rawItems.length, category, kept: false });
          continue;
        }

        const fields = await extractByType(item, category);
        if (!fields) {
          processed++;
          onProgress?.({ stage: 'extract', i: processed, total: rawItems.length, kept: false });
          continue;
        }

        const suit = await paintSuit(fields);

        const card = {
          id: hashId(item.sourceMeta?.type || 'src', item.id),
          contentType: fields.contentType,
          title: fields.title,
          summary: fields.summary,
          passage: fields.passage,
          insights: fields.insights,
          suit: suit.suitId,
          suitName: suit.suitName,
          source: {
            type: item.sourceMeta?.type || 'unknown',
            path: item.sourceMeta?.path || null,
            label: item.sourceMeta?.label || null
          },
          createdAt: item.createdAt || Date.now(),
          tags: item.tags || []
        };

        cards.push(card);
        stats.kept++;
        stats.suitDist[suit.suitId] = (stats.suitDist[suit.suitId] || 0) + 1;
        processed++;
        onProgress?.({ stage: 'done', i: processed, total: rawItems.length, category, suit: suit.suitId, kept: true });
      } catch (e) {
        processed++;
        console.error(`[pipeline] item ${i} failed:`, e.message);
      }
    }
  }

  // 启动 N 个 worker 并发跑
  const workers = Array.from({ length: Math.min(concurrency, rawItems.length) }, () => worker());
  await Promise.all(workers);

  return { cards, stats };
}

/**
 * 完整 pipeline：source 适配器 → process
 */
async function runPipelineV2(opts, onProgress) {
  const adapter = ADAPTERS[opts.source];
  if (!adapter) throw new Error(`Unknown source: ${opts.source}`);
  const items = adapter(opts.input);
  return await processItems(items, onProgress);
}

module.exports = { runPipelineV2, processItems };
