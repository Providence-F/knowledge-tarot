/**
 * src/extractors/index.js — Extractor dispatcher
 * 根据 contentType（来自 triager）调度到对应的 extractor
 */

const reflection = require('./reflection');
const opinion = require('./opinion');
const analysis = require('./analysis');

/**
 * @param {RawItem} rawItem
 * @param {string} contentType - 来自 triager.triage()
 * @returns {Promise<CardFields>}
 */
async function extractByType(rawItem, contentType) {
  switch (contentType) {
    case 'reflection':
      return reflection.extract(rawItem);
    case 'analysis':
      return await analysis.extract(rawItem);
    case 'opinion':
      return await opinion.extract(rawItem);
    case 'data':
    case 'code':
    case 'other':
      // 不入牌堆，由 pipeline 决定丢弃
      return null;
    default:
      return await opinion.extract(rawItem);
  }
}

module.exports = { extractByType };
