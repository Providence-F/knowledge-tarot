/**
 * src/extractors/opinion.js — 观点类：轻提炼
 *
 * 适用：文章、笔记、方法论、见解。
 * - 一次 LLM 调用：提炼 30-80 字的核心 summary
 * - passage = 原文清洗后的片段（≤500 字）
 * - 成本 ~0.001 元/张
 */

const { cleanForDisplay, truncateAtBoundary } = require('../utils');
const { callJSON } = require('../llm');

const SYSTEM_PROMPT = `你是一个内容萃取师。用户给你一段笔记/文章/观点，你要提炼出"这段话真正想说的核心判断"。

要求：
- 30-80 字
- 是判断或观察，不是总结
- 必须从原文出发，不要拔高、不要加自己的解读、不要鸡汤
- 保留原文的语气特点（如果原文是吐槽就保留吐槽感，原文严谨就保留严谨感）
- 禁止"在快节奏的世界里""值得注意的是"等套话

只输出 JSON：{"summary": "..."}`;

async function extract(rawItem) {
  const body = (rawItem.body || '').replace(/^---[\s\S]*?---\r?\n/, '');
  const cleanBody = cleanForDisplay(body);
  const passage = truncateAtBoundary(cleanBody, 500);

  let summary = '';
  try {
    // 给 LLM 看的内容比 passage 多一点（最多 1500 字）
    const sampleForLLM = cleanBody.slice(0, 1500);
    const result = await callJSON(SYSTEM_PROMPT, sampleForLLM, {
      maxTokens: 200,
      temperature: 0.4
    });
    // 容忍 LLM 偶尔返回不同字段名
    const candidates = [result.summary, result.core_judgment, result.judgment, result.core, result.text];
    for (const c of candidates) {
      if (c && typeof c === 'string' && c.trim().length > 0) {
        summary = c.trim().slice(0, 200);
        break;
      }
    }
  } catch (e) {
    console.error(`[opinion] LLM error for ${rawItem.id}:`, e.message);
  }

  return {
    contentType: 'opinion',
    title: rawItem.title || '',
    passage,
    fullPassage: cleanBody,
    summary,
    insights: null
  };
}

module.exports = { extract };
