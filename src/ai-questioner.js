/**
 * src/ai-questioner.js — 运行时 LLM：起牌名 + AI 提问
 *
 * 三种调用：
 *   1. nameCards(cards, question, style) - 给一批牌起牌名（5-10 字）
 *   2. askSingle(card, question, style)   - 单牌反思的 1-3 个问题
 *   3. askThree(cards, question, style)   - 三牌阵叙事 + 反问
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

const COMMON_BAN = `**风格底线（绝对不能违反）**：
- 不要解读这张牌
- 不要给建议（"或许""可以试试""不妨"）
- 不要总结
- 不要鸡汤（"加油""你已经很棒了""一切都会好的""愿你"）
- 不要"根据这张牌……" / "这张牌告诉我们……"
- 不要刻意、虚伪、塑料感
- 永远在和用户聊天，不在分析

可以一针见血、可以温柔关怀，但绝对不能假。`;

// ── 起牌名 ────────────────────────────────────────────────

const NAME_SYS = `你正在为刚翻开的塔罗牌起名（5-10 字）。

要求：
- 必须从这张牌的具体内容（不是抽象主题）出发
- 像一个判断或观察，不像鸡汤
- 有画面感，有锋利度
- 禁止模板：xx之x、被忽视的xx、看不见的xx、还没说出口、不能说的xx
- 禁止"光""旅程""方向""智慧""能量"等空洞大词

只输出 JSON：{"titles": ["第一张牌的牌名", "第二张牌的牌名", ...]}（数组顺序对应输入）`;

async function nameCards(cards, question) {
  if (!cards || cards.length === 0) return [];
  const userMsg = buildNameUserMsg(cards, question);
  try {
    const result = await callJSON(NAME_SYS, userMsg, {
      maxTokens: 400,
      temperature: 0.7  // 起名鼓励多样性
    });
    if (Array.isArray(result.titles)) {
      return result.titles.map(t => String(t || '').trim().slice(0, 30));
    }
  } catch (e) {
    console.error('[nameCards] error:', e.message);
  }
  // 兜底：用 summary 前 10 字 / passage 前 10 字
  return cards.map(c => (c.summary || c.passage || c.title || '').slice(0, 10) || '—');
}

function buildNameUserMsg(cards, question) {
  let s = question
    ? `用户的问题：${question}\n\n`
    : `（用户没有提问，直接抽牌）\n\n`;
  s += `${cards.length} 张牌：\n\n`;
  cards.forEach((c, i) => {
    const body = c.contentType === 'analysis'
      ? (c.summary + (c.insights ? '\n要点：' + c.insights.join('；') : ''))
      : (c.passage || c.summary || c.title);
    s += `第 ${i + 1} 张${c.positionName ? `（${c.positionName}）` : ''}：\n${body.slice(0, 500)}\n\n`;
  });
  s += `请按顺序为每张牌起一个 5-10 字的牌名。`;
  return s;
}

// ── 单牌反思 ──────────────────────────────────────────────

function buildSingleSys(style) {
  const guide = STYLE_GUIDE[style] || STYLE_GUIDE.gentle;
  return `你是一个会提问的陪伴者，像 OH 卡治疗师那样工作。
你不解读牌、不给建议、不总结——你只问问题，让用户向内看。

${guide}

${COMMON_BAN}

抛出 1-3 个问题。每个问题独立成行。

只输出 JSON：{"questions": ["问题1", "问题2", "问题3"]}`;
}

async function askSingle(card, question, style = 'gentle') {
  const cardBody = card.contentType === 'analysis'
    ? `核心：${card.summary}\n\n要点：${(card.insights || []).join('；')}`
    : (card.passage || card.summary || card.title);

  const userMsg = (question
    ? `用户的问题：${question}\n\n`
    : `（用户没有提问，直接抽到了这张牌）\n\n`
  ) + `这张牌的内容：\n${cardBody.slice(0, 1200)}`;

  try {
    const result = await callJSON(buildSingleSys(style), userMsg, {
      maxTokens: 500,
      temperature: 0.7
    });
    if (Array.isArray(result.questions) && result.questions.length > 0) {
      return result.questions.map(q => String(q).trim()).filter(Boolean).slice(0, 3);
    }
  } catch (e) {
    console.error('[askSingle] error:', e.message);
  }
  return ['这张牌让你想到什么？'];
}

// ── 三牌阵 ────────────────────────────────────────────────

function buildThreeSys(style) {
  const guide = STYLE_GUIDE[style] || STYLE_GUIDE.gentle;
  return `你是一个会编织叙事的陪伴者。三张牌被放在过去、现在、未来三个位置。
你不在预测，也不在解读。你在帮用户把碎片串起来看。

${guide}

${COMMON_BAN}

输出两部分：
- narrative：把三张牌串成一个简短的情境（不是解读，是想象一个画面），3-5 句话
- question：一个尖锐的反问，戳到用户问题的根本

只输出 JSON：{"narrative": "...", "question": "..."}`;
}

async function askThree(cards, question, style = 'gentle') {
  const userMsg = buildThreeUserMsg(cards, question);
  try {
    const result = await callJSON(buildThreeSys(style), userMsg, {
      maxTokens: 800,
      temperature: 0.7
    });
    return {
      narrative: typeof result.narrative === 'string' ? result.narrative.trim() : '',
      question: typeof result.question === 'string' ? result.question.trim() : ''
    };
  } catch (e) {
    console.error('[askThree] error:', e.message);
    return { narrative: '', question: '' };
  }
}

function buildThreeUserMsg(cards, question) {
  let s = question
    ? `用户的问题：${question}\n\n`
    : `（用户没有提问，直接抽到了这三张牌）\n\n`;
  s += `三张牌：\n\n`;
  cards.forEach(c => {
    const body = c.contentType === 'analysis'
      ? (c.summary + (c.insights ? '\n要点：' + c.insights.join('；') : ''))
      : (c.passage || c.summary || c.title);
    s += `【${c.positionName}】牌名：${c.title || '（待命名）'}\n内容：${body.slice(0, 600)}\n\n`;
  });
  return s;
}

// ── 深度对话单轮 ──────────────────────────────────────────

function buildDialogueSys(style) {
  const guide = STYLE_GUIDE[style] || STYLE_GUIDE.gentle;
  return `你是一个用苏格拉底式提问的陪伴者。围绕一张或几张牌，与用户深度对话。
不告诉用户答案，只通过问题让 ta 自己想出来。每轮只问一个问题。

${guide}

${COMMON_BAN}

对话规则：
- 每轮只问一个问题，不要"or"，不要罗列
- 顺着用户上轮回答深挖，不要跳话题
- 用户回避时不戳破，换个角度再问
- 用户卡住时给一个具体的小切口（"上次让你这样想的时候是什么时候？"）
- 如果有多张牌，把它们当成一个整体情境，不要分开解读

只输出 JSON：{"question": "你下一个问题"}`;
}

function cardBodyText(card) {
  if (card.contentType === 'analysis') {
    return `核心：${card.summary || ''}\n要点：${(card.insights || []).join('；')}`;
  }
  return card.passage || card.summary || card.title || '';
}

const FALLBACK_OPENERS = [
  '让你这样写下来的那一刻，发生了什么？',
  '看到这张牌出现在面前，你身体先有反应还是脑子先有反应？',
  '你写下这段话的时候，是想给谁看？',
  '如果这张牌是过去的你寄给现在的你的一封信，开头第一句你会读出来吗？',
  '这段文字里你最想绕开的是哪一句？',
  '现在让你最不想回答的那个问题，其实是什么？'
];

function pickFallbackOpener(userQuestion) {
  if (userQuestion && userQuestion.trim()) {
    return `你刚才问"${userQuestion.trim()}"——这个问题里，最让你卡住的部分是什么？`;
  }
  return FALLBACK_OPENERS[Math.floor(Math.random() * FALLBACK_OPENERS.length)];
}

async function dialogueTurn(cardOrCards, transcript, style = 'gentle', userQuestion = '') {
  const cards = Array.isArray(cardOrCards) ? cardOrCards : [cardOrCards];

  // 首轮且没有用户输入 → 直接走保底，不烧 LLM
  if ((!transcript || transcript.length === 0) && cards.length > 0) {
    // 仍然走 LLM 拿一个针对内容的开场，但失败兜底
  }

  const cardsBlock = cards.map((c, i) => {
    const head = cards.length > 1
      ? `【第 ${i + 1} 张${c.positionName ? ' · ' + c.positionName : ''}】牌名：${c.title || '—'}`
      : `牌名：${c.title || '—'}`;
    return `${head}\n${cardBodyText(c).slice(0, 600)}`;
  }).join('\n\n');

  const transcriptText = (transcript || []).map(t =>
    `${t.role === 'ai' ? 'AI' : '用户'}：${t.text}`
  ).join('\n');

  const userMsg = (userQuestion ? `用户最初的问题：${userQuestion}\n\n` : '')
    + `牌：\n${cardsBlock}\n\n对话记录：\n${transcriptText || '（这是对话开始，请抛出第一个问题——可以贴近用户最初的问题，也可以从牌内容切入）'}`;

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
  return pickFallbackOpener(userQuestion);
}

module.exports = { nameCards, askSingle, askThree, dialogueTurn, FALLBACK_OPENERS };
