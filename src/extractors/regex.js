/**
 * src/extractors/regex.js — 旧 Obsidian 中文文案约定的正则提炼器
 * 保留原 build-deck.js 行为：> **核心主张**：xxx / ## 核心洞察 / > **适用场景**：xxx
 * 这是 M0 阶段唯一的 extractor，让 Kai 自己的库行为不退化。
 * M1 会加上 LLM 版做兜底。
 */

const { cleanForDisplay, truncateAtBoundary } = require('../utils');

function extract(rawItem) {
  // textdump 没有 rawContent；obsidian 有
  const fullContent = rawItem.sourceMeta?.rawContent || rawItem.body;
  const body = rawItem.body;
  const fm = rawItem.sourceMeta?.frontmatter || {};

  return {
    contentType: 'opinion',  // M0 默认全部按"观点类"处理（保留原 schema）
    title: rawItem.title,
    summary: extractCoreClaim(body, fm),
    scenario: extractScenario(body),
    passage: extractPassage(fullContent),
    keyInsights: extractKeyInsight(body),
    structuredSections: extractStructuredPassage(fullContent)
  };
}

function extractCoreClaim(content, fm) {
  const exact = content.match(/>\s*\*\*核心主张\*\*[：:]\s*(.+)/);
  if (exact) return cleanForDisplay(exact[1]).slice(0, 300);
  const fuzzy = content.match(/> .*核心主张.*[：:]\s*(.+)/);
  if (fuzzy) return cleanForDisplay(fuzzy[1]).slice(0, 300);
  const firstQuote = content.match(/>\s*(.+)/);
  if (firstQuote) return cleanForDisplay(firstQuote[1]).slice(0, 300);
  return (fm?.title || content.slice(0, 120)).replace(/[#*`>\-]/g, '').trim();
}

function extractScenario(content) {
  const exact = content.match(/>\s*\*\*适用场景\*\*[：:]\s*(.+)/);
  if (exact) return cleanForDisplay(exact[1]).slice(0, 300);
  const fuzzy = content.match(/> .*适用场景.*[：:]\s*(.+)/);
  if (fuzzy) return cleanForDisplay(fuzzy[1]).slice(0, 300);
  return '';
}

function extractPassage(content) {
  const sectionMatch = content.match(/#{2,3}\s*核心洞察\s*\r?\n([\s\S]*?)(?=\r?\n#{2,3}\s|\r?\n---|\Z)/);
  if (sectionMatch) return truncateAtBoundary(cleanForDisplay(sectionMatch[1]), 800);
  const body = content.replace(/^---[\s\S]*?---\r?\n/, '').replace(/^#.+\r?\n/, '');
  return truncateAtBoundary(cleanForDisplay(body), 500);
}

function extractKeyInsight(content) {
  const insightSection = content.match(/#{2,3}\s*核心洞察\s*\r?\n([\s\S]*?)(?=\r?\n#{2,3}\s|\r?\n---|\Z)/);
  if (insightSection) {
    const cleaned = cleanForDisplay(insightSection[1]);
    const points = cleaned.split(/\n/)
      .map(l => l.replace(/^[-*]\s*/, '').trim())
      .filter(l => l.length > 10 && l.length < 200 && !l.startsWith('#'))
      .slice(0, 3);
    if (points.length > 0) return points;
  }
  const claimMatch = content.match(/>\s*\*\*核心主张\*\*[：:]\s*(.+)/);
  if (claimMatch) return [cleanForDisplay(claimMatch[1]).slice(0, 200)];
  const quotes = [...content.matchAll(/>\s*(.+)/g)]
    .map(m => cleanForDisplay(m[1]))
    .filter(q => q.length > 15 && q.length < 200 && !q.match(/^(研究日期|来源|日期|创建|更新|###)/))
    .slice(0, 3);
  if (quotes.length > 0) return quotes;
  const bolds = [...content.matchAll(/\*\*(.+?)\*\*/g)]
    .map(m => cleanForDisplay(m[1]))
    .filter(b => b.length > 4 && b.length < 50 && !b.match(/核心主张|适用场景|来源|相关|###/))
    .slice(0, 3);
  if (bolds.length > 0) return bolds;
  return null;
}

function extractStructuredPassage(content) {
  const sections = [];
  const claim = content.match(/>\s*\*\*核心主张\*\*[：:]\s*(.+)/);
  if (claim) sections.push({ type: 'claim', text: truncateAtBoundary(cleanForDisplay(claim[1]), 300) });
  const insight = content.match(/#{2,3}\s*核心洞察\s*\r?\n([\s\S]*?)(?=\r?\n#{2,3}\s|\r?\n---|\Z)/);
  if (insight) sections.push({ type: 'insight', text: truncateAtBoundary(cleanForDisplay(insight[1]), 500) });
  const scenario = content.match(/>\s*\*\*适用场景\*\*[：:]\s*(.+)/);
  if (scenario) sections.push({ type: 'scenario', text: truncateAtBoundary(cleanForDisplay(scenario[1]), 300) });
  return sections.length > 0 ? sections : null;
}

module.exports = { extract };
