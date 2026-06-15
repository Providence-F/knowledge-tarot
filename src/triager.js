/**
 * src/triager.js — 内容类型分诊
 * 按硬规则 + LLM 判断，把 RawItem 分到 6 类之一：
 * reflection / opinion / analysis / data / code / other
 */

const path = require('path');
const { callJSON } = require('./llm');

const HARD_REJECT_EXTS = new Set([
  '.csv', '.xlsx', '.xls', '.pdf', '.pptx', '.ppt',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.mp4', '.mov', '.mp3', '.wav',
  '.zip', '.tar', '.gz'
]);

const CODE_EXTS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.rb', '.sh', '.sql', '.json', '.yaml', '.yml', '.toml'
]);

const CATEGORIES = ['reflection', 'opinion', 'analysis', 'data', 'code', 'other'];

const SYSTEM_PROMPT = `你是一个内容分类器。把用户笔记/文档分类到下面 6 类之一：

- reflection（反思类）：日记、感悟、读后感、心情记录、灵感、自我反思
- opinion（观点类）：文章、知识总结、方法论、见解、观察、个人想法
- analysis（分析类）：产品分析、行业调研、PRD、研究报告、竞品对比、有大量数据/论证的长文
- data（数据类）：表格、发票、报价、清单、纯数据罗列、证书凭证
- code（代码类）：代码、配置、技术规范文档
- other（其他/无价值）：导航页、空模板、纯链接收藏、无内容

只输出 JSON：{"category": "reflection"}（值是 6 个英文类别之一，不要别的字段）。`;

/**
 * 同步硬规则。返回 null 表示需要走 LLM。
 */
function hardRule(rawItem) {
  const sourcePath = rawItem.sourceMeta?.path || '';
  const ext = path.extname(sourcePath).toLowerCase();
  if (HARD_REJECT_EXTS.has(ext)) return 'data';
  if (CODE_EXTS.has(ext)) return 'code';

  const body = (rawItem.body || '').trim();
  if (body.length < 30) return 'other';

  // Obsidian frontmatter 中显式标记 type 的，直接用
  const fmType = rawItem.sourceMeta?.frontmatter?.type;
  if (typeof fmType === 'string' && CATEGORIES.includes(fmType)) return fmType;

  return null;
}

/**
 * 异步 LLM 分诊
 */
async function llmTriage(rawItem) {
  const sample = (rawItem.body || '').slice(0, 800);
  const userPrompt = `内容：\n${sample}\n\n请分类。`;
  try {
    const result = await callJSON(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 50,
      temperature: 0.0
    });
    const cat = result.category;
    if (CATEGORIES.includes(cat)) return cat;
  } catch (e) {
    console.error(`[triager] LLM error for ${rawItem.id}:`, e.message);
  }
  return 'opinion';  // 兜底归到观点类
}

/**
 * 主入口：硬规则优先，未命中走 LLM
 * @param {RawItem} rawItem
 * @returns {Promise<string>} category
 */
async function triage(rawItem) {
  const hard = hardRule(rawItem);
  if (hard) return hard;
  return await llmTriage(rawItem);
}

module.exports = { triage, hardRule, llmTriage, CATEGORIES };
