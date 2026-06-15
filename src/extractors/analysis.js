/**
 * src/extractors/analysis.js — 分析类：重提炼出洞察
 *
 * 适用：产品分析、行业调研、PRD、研究报告。
 * - 一次 LLM 调用：提炼核心判断 + 2-3 条洞察 bullet
 * - 不展示原文（避免数据细节破坏卡片美感）
 * - 成本 ~0.003 元/张
 *
 * 长文（>5000 字）会先做截断（前 4000 字 + 后 1000 字），让 LLM 看到首尾。
 */

const { cleanForDisplay } = require('../utils');
const { callJSON } = require('../llm');

const SYSTEM_PROMPT = `你是一个洞察萃取师。用户给你一份分析/报告/调研，你要把它压缩成"塔罗牌牌面"——只留下最有洞察力的判断。

要求：
- summary：30-80 字，整份分析里最锋利的一句核心判断
- insights：2-3 条 bullet，每条 30-60 字，是支撑核心判断的具体洞察
- 必须从原文出发，不要拔高、不要拼凑
- 丢掉所有数据罗列、来源引用、无意义的过渡
- 一针见血、有洞察力，但不能虚伪、刻意、塑料
- 禁止鸡汤话术、禁止"在 xx 大背景下"等套话

只输出 JSON：{"summary": "...", "insights": ["...", "...", "..."]}`;

async function extract(rawItem) {
  const body = (rawItem.body || '').replace(/^---[\s\S]*?---\r?\n/, '');
  const cleanBody = cleanForDisplay(body);

  // 长文截断：前 4000 + 后 1000
  let sampleForLLM;
  if (cleanBody.length <= 5000) {
    sampleForLLM = cleanBody;
  } else {
    sampleForLLM = cleanBody.slice(0, 4000) + '\n\n[…中间省略…]\n\n' + cleanBody.slice(-1000);
  }

  let summary = '', insights = null;
  try {
    const result = await callJSON(SYSTEM_PROMPT, sampleForLLM, {
      maxTokens: 600,
      temperature: 0.4
    });
    if (result.summary && typeof result.summary === 'string') {
      summary = result.summary.trim().slice(0, 200);
    } else {
      // 容忍字段名变体
      const cand = result.core_judgment || result.judgment || result.core;
      if (cand && typeof cand === 'string') summary = cand.trim().slice(0, 200);
    }
    if (Array.isArray(result.insights)) {
      insights = result.insights
        .map(s => String(s).trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 3);
      if (insights.length === 0) insights = null;
    }
  } catch (e) {
    console.error(`[analysis] LLM error for ${rawItem.id}:`, e.message);
  }

  return {
    contentType: 'analysis',
    title: rawItem.title || '',
    passage: '',  // 分析类不展示原文
    summary,
    insights
  };
}

module.exports = { extract };
