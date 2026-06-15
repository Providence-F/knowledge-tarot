/**
 * src/extractors/reflection.js — 反思类：原文即用
 *
 * 适用：日记、感悟、心情记录。OH 卡式机制下，越粗糙越能投射。
 * - passage = 原文清洗后的片段（≤500 字）
 * - summary = 不预生成（运行时 LLM 现起）
 * - 不调 LLM，0 成本
 */

const { cleanForDisplay, truncateAtBoundary } = require('../utils');

function extract(rawItem) {
  const body = (rawItem.body || '').replace(/^---[\s\S]*?---\r?\n/, '');
  const cleaned = cleanForDisplay(body);
  const passage = truncateAtBoundary(cleaned, 500);
  return {
    contentType: 'reflection',
    title: rawItem.title || '',
    passage,
    fullPassage: cleaned,
    summary: '',
    insights: null
  };
}

module.exports = { extract };
