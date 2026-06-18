/**
 * src/ai-questioner.js — 运行时 LLM
 *
 * 知识塔罗 v2.0：从"OH 卡治疗师"风格改成"安静的旁观者"。
 *
 * 调用：
 *   1. nameCards(cards, question, style)   - 给一批牌起 dynamicTitle（5-10 字）
 *   2. dialogueOpener(card, question, userReaction, style)  - 用户写完反应后 AI 的"接桥"
 *   3. dialogueTurn(card, transcript, style, userQuestion)  - 后续轮的 AI 提问（最多 3 轮）
 *   4. askSingle / askThree                 - 兼容老路径，现在仅在前端兜底（默认不再调）
 *
 * 风格 style: gentle | sharp | philosophical | playful
 */

const { callJSON } = require('./llm');

const STYLE_GUIDE = {
  gentle: `语气：温柔、陪伴、稳定。像一个安静的朋友坐在你旁边。
不催促、不评判、不抒情。允许停顿和沉默。`,
  sharp: `语气：一针见血、克制、有洞察力。像一个看穿你的老朋友。
直说不绕弯，但不刻薄。指出回避而非攻击它。`,
  philosophical: `语气：从更大的尺度发问，引向意义和悖论。
不追求答案，追求让你看见更多面向。不掉书袋。`,
  playful: `语气：俏皮、轻盈、带点反差。在严肃话题里点一个意外的笑点。
但不油腻、不油滑。幽默是为了松一下，不是为了炫。`
};

const COMMON_BAN = `**底线（绝对不能违反）**：
- 不要解读这张牌
- 不要给建议（"或许""可以试试""不妨"）
- 不要总结
- 不要鸡汤（"加油""你已经很棒了""一切都会好的""愿你"）
- 不要"根据这张牌……" / "这张牌告诉我们……"
- 不要复述卡的原文细节，让用户自己去读
- 永远在和用户聊天，不在分析`;

// 把 question 兼容两种形态：string 或 {q1,q2,q3}
function questionToText(question) {
  if (!question) return '';
  if (typeof question === 'string') return question.trim();
  if (typeof question === 'object') {
    const { q1, q2, q3 } = question;
    const parts = [];
    if (q1) parts.push(`今天想问的：${q1}`);
    if (q2) parts.push(`隐约觉得答案：${q2}`);
    if (q3) parts.push(`最害怕的答案：${q3}`);
    return parts.join('\n');
  }
  return '';
}

// ── 起牌名 ────────────────────────────────────────────────

const NAME_SYS = `你正在为刚翻开的塔罗牌起 dynamicTitle（5-10 字）。

要求：
- 必须从这张牌的具体内容（不是抽象主题）出发
- 像一个判断或观察，不像鸡汤
- 有画面感，有锋利度
- 如果用户有提问，让标题在"卡内容"和"提问"之间架一座桥（但不要直接回答问题）
- 禁止模板：xx之x、被忽视的xx、看不见的xx、还没说出口、不能说的xx
- 禁止"光""旅程""方向""智慧""能量"等空洞大词

只输出 JSON：{"titles": ["第一张牌名", "第二张牌名", ...]}（数组顺序对应输入）`;

async function nameCards(cards, question) {
  if (!cards || cards.length === 0) return [];
  const userMsg = buildNameUserMsg(cards, question);
  try {
    const result = await callJSON(NAME_SYS, userMsg, {
      maxTokens: 400,
      temperature: 0.7
    });
    if (Array.isArray(result.titles)) {
      return result.titles.map(t => String(t || '').trim().slice(0, 30));
    }
  } catch (e) {
    console.error('[nameCards] error:', e.message);
  }
  // 兜底：不再用 summary 前 10 字（破坏陌生化），用占位词
  return cards.map(() => '（待命名）');
}

function buildNameUserMsg(cards, question) {
  const qText = questionToText(question);
  let s = qText
    ? `用户的提问：\n${qText}\n\n`
    : `（用户没有提问，直接抽牌）\n\n`;
  s += `${cards.length} 张牌：\n\n`;
  cards.forEach((c, i) => {
    const body = c.contentType === 'analysis'
      ? (c.summary + (c.insights ? '\n要点：' + c.insights.join('；') : ''))
      : (c.passage || c.summary || c.title);
    s += `第 ${i + 1} 张${c.positionName ? `（${c.positionName}）` : ''}${c.orientation === 'reversed' ? '【逆位】' : ''}：\n${(body || '').slice(0, 500)}\n\n`;
  });
  s += `请按顺序为每张牌起一个 5-10 字的 dynamicTitle。`;
  return s;
}

// ── 安静的旁观者：用户写完反应后的"接桥" ──────────────────

function buildOpenerSys(style) {
  const guide = STYLE_GUIDE[style] || STYLE_GUIDE.gentle;
  return `你是一个"安静的旁观者"。

用户带着 ta 当下的困惑来。我们随机抽出了一段 ta 自己过去写下的话
（或 ta 曾经收藏认同的话）。ta 大概率已经忘了写过/读过这段。
ta 已经看到这张牌了，并写下了"第一反应"。

你的任务非常克制：
- 如果用户的反应已经把"过去的自己"和"当下的问题"接上了 → 只说一句简短的肯定（< 30 字），不要画蛇添足
- 如果用户卡住、写得很短、明显在回避 → 抛一个尖锐但具体的问题，让 ta 自己往下想
- 永远不要替 ta 总结、给建议、长篇大论

${guide}

${COMMON_BAN}

输出两个字段：
- ack：一句简短的回应或肯定（< 30 字，可以为空字符串）
- question：一个具体的反问（如果用户已说透，可以为空字符串）

至少有一项非空。如果用户已经接上桥，仅给 ack；如果卡住，仅给 question。

只输出 JSON：{"ack": "...", "question": "..."}`;
}

async function dialogueOpener(card, question, userReaction, style = 'gentle') {
  const cardBody = card.contentType === 'analysis'
    ? `核心：${card.summary || ''}\n要点：${(card.insights || []).join('；')}`
    : (card.passage || card.summary || card.title || '');

  const qText = questionToText(question);
  const orient = card.orientation === 'reversed' ? '【逆位 · 提问角度更尖锐】' : '';

  const userMsg = (qText ? `用户的提问：\n${qText}\n\n` : '（用户没有提问）\n\n')
    + `这张牌${orient}：\n${cardBody.slice(0, 1200)}\n\n`
    + `用户看到这张牌后的第一反应：\n${(userReaction || '（用户没有写下反应）').slice(0, 800)}`;

  try {
    const result = await callJSON(buildOpenerSys(style), userMsg, {
      maxTokens: 300,
      temperature: 0.7
    });
    const ack = typeof result.ack === 'string' ? result.ack.trim().slice(0, 80) : '';
    const q = typeof result.question === 'string' ? result.question.trim().slice(0, 200) : '';
    if (ack || q) return { ack, question: q };
  } catch (e) {
    console.error('[dialogueOpener] error:', e.message);
  }
  return { ack: '', question: '这段过去的你，跟现在的你之间，藏着什么你已经忘了的连接？' };
}

// ── 后续轮：每轮一个尖锐问题，最多 3 轮 ──────────────────

const MAX_AI_TURNS = 3;

function buildDialogueSys(style) {
  const guide = STYLE_GUIDE[style] || STYLE_GUIDE.gentle;
  return `你是一个"安静的旁观者"，不是话痨陪聊师。

围绕一段过去的自己写下的话（或曾经认同的话），与用户深度对话。
不告诉答案，只通过具体问题让 ta 自己看到连接。

${guide}

${COMMON_BAN}

对话规则：
- 每轮只问一个问题，不要 "or"、不要罗列
- 顺着用户上轮回答深挖，不要跳话题
- 用户回避时不戳破，换角度再问
- 用户卡住时给一个具体小切口（"上次让你这样想的时候是什么时候？"）
- 用户读完后能关掉网页去思考——这是成功，不是失败

只输出 JSON：{"question": "你下一个问题"}`;
}

function cardBodyText(card) {
  if (card.contentType === 'analysis') {
    return `核心：${card.summary || ''}\n要点：${(card.insights || []).join('；')}`;
  }
  return card.passage || card.summary || card.title || '';
}

async function dialogueTurn(cardOrCards, transcript, style = 'gentle', userQuestion = '') {
  const cards = Array.isArray(cardOrCards) ? cardOrCards : [cardOrCards];
  const qText = questionToText(userQuestion);

  const cardsBlock = cards.map((c, i) => {
    const head = cards.length > 1
      ? `【第 ${i + 1} 张${c.positionName ? ' · ' + c.positionName : ''}${c.orientation === 'reversed' ? ' · 逆位' : ''}】牌名：${c.title || '—'}`
      : `牌名：${c.title || '—'}${c.orientation === 'reversed' ? '（逆位）' : ''}`;
    return `${head}\n${cardBodyText(c).slice(0, 600)}`;
  }).join('\n\n');

  const transcriptText = (transcript || []).map(t =>
    `${t.role === 'ai' ? 'AI' : '用户'}：${t.text}`
  ).join('\n');

  const userMsg = (qText ? `用户最初的提问：\n${qText}\n\n` : '')
    + `牌：\n${cardsBlock}\n\n对话记录：\n${transcriptText || '（这是对话开始，请抛出第一个问题——从这张过去的话切入）'}`;

  try {
    const result = await callJSON(buildDialogueSys(style), userMsg, {
      maxTokens: 300,
      temperature: 0.7
    });
    if (typeof result.question === 'string' && result.question.trim()) {
      return result.question.trim();
    }
  } catch (e) {
    console.error('[dialogueTurn] error:', e.message);
  }
  return '过去的你已经回答过现在的你了，你听到了吗？';
}

function countAITurns(transcript) {
  if (!Array.isArray(transcript)) return 0;
  return transcript.filter(t => t && t.role === 'ai').length;
}

// ── 兼容旧调用（v2.html 老前端可能仍在调） ────────────────

async function askSingle(card, question, style = 'gentle') {
  // 不再主动抛 3 个问题——返回空数组，让前端走"用户先写第一反应"的新流程
  return [];
}

async function askThree(cards, question, style = 'gentle') {
  return { narrative: '', question: '' };
}

module.exports = {
  nameCards,
  dialogueOpener,
  dialogueTurn,
  askSingle,
  askThree,
  countAITurns,
  questionToText,
  MAX_AI_TURNS
};
