/**
 * src/classifiers/suit-painter.js — 给 Card 贴花色（纯装饰）
 *
 * 输入：CardFields（已经有 title/summary/passage）
 * 输出：{ suitId, suitName, confidence }
 *
 * 一次廉价 LLM 调用 ~100 token，~0.0002 元/张。
 * 错了无所谓——花色只决定卡背颜色。
 */

const { callJSON } = require('../llm');

const SUITS = [
  { id: 'sword-of-self', name: '自我之剑', desc: '关于"我是谁"——身份、价值观、性格、自我认知' },
  { id: 'mirror-of-world', name: '世界之镜', desc: '关于"世界是什么样"——外部观察、趋势、社会洞察' },
  { id: 'compass-of-method', name: '方法之罗盘', desc: '关于"怎么做"——方法论、框架、技能、思维模型' },
  { id: 'ship-of-action', name: '行动之舟', desc: '关于"我做了什么"——项目、实践、产出、案例' },
  { id: 'seed-of-growth', name: '成长之种', desc: '关于"我变成了什么"——成长、反思、感受、日常' }
];

const SYSTEM_PROMPT = `你要把一段内容贴上"花色"标签。5 个花色：
${SUITS.map(s => `- ${s.id} (${s.name})：${s.desc}`).join('\n')}

只输出 JSON：{"suit": "<上面 5 个 id 之一>"}`;

const SUIT_BY_ID = Object.fromEntries(SUITS.map(s => [s.id, s]));

/**
 * @param {CardFields} fields
 * @returns {Promise<{suitId, suitName, confidence}>}
 */
async function paintSuit(fields) {
  // 喂 LLM 的内容：summary 优先，其次 passage 前 200 字
  const sample = (fields.summary || fields.passage || fields.title || '').slice(0, 300);
  if (!sample) {
    return { suitId: 'seed-of-growth', suitName: '成长之种', confidence: 0 };
  }

  try {
    const result = await callJSON(SYSTEM_PROMPT, sample, {
      maxTokens: 30,
      temperature: 0.0
    });
    const id = result.suit;
    if (id && SUIT_BY_ID[id]) {
      return { suitId: id, suitName: SUIT_BY_ID[id].name, confidence: 0.8 };
    }
  } catch (e) {
    console.error('[suit-painter] LLM error:', e.message);
  }
  // 兜底：成长之种（最中性的花色）
  return { suitId: 'seed-of-growth', suitName: '成长之种', confidence: 0 };
}

module.exports = { paintSuit, SUITS, SUIT_BY_ID };
