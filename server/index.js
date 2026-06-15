/**
 * server/index.js — Express 服务器 + AI 解读 API
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/data', express.static(path.join(__dirname, '..', 'data')));

// ── v2 路由（多源接入 + 用户系统） ────────────────────────
const v2Routes = require('./v2-routes');
app.use('/api/v2', v2Routes);

// ── Health ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── System Prompts (JSON 模式) ───────────────────────────
const STYLE_AND_BAN = `【解读风格】
- 清醒、直接、有洞察力
- 引用牌中的具体概念或原文片段
- 像精神分析师在做自由联想，而不是鸡汤导师在做心灵按摩
- 用具体的观察代替抽象的隐喻

【禁止】
- "照亮当下"、"生命旅程"、"智慧之镜"等空洞修辞
- "xx之x"的机械格式
- 没有具体内容的泛化感悟
- 任何模板化的、可以套在任何牌上的标题（例如"被忽视的价值""看不见的代价""还没说出口"这类空泛短语，绝对禁止使用）

【标题原则】
- 5-10 字
- 必须由这张牌的具体内容（核心主张/原文片段）+ 用户问题/位置共同推出，换一张牌或换一个问题就应该是不同的标题
- 有画面感，像一个判断或观察
- 好例子风格："4.5 小时的空白"、"信任的价格"、"场景说了算"、"倒着走"

【JSON 规范（必须严格遵守）】
- 所有字段值是字符串。字符串内严禁出现英文双引号 " 字符——若需引用某段话或词组，请使用中文书名号「」或单引号 ' '
- 不要在 JSON 外加任何 markdown 代码块标记、解释文字、前后缀
- 直接以 { 开头，以 } 结尾
- 字段顺序无要求，但每个字段都必须存在`;

const SYSTEM_PROMPT_SINGLE = `你是一个知识分析师。用户从个人知识库中抽到了一张塔罗牌，你根据牌的内容和用户的问题给出解读。

${STYLE_AND_BAN}

【输出格式】严格输出 JSON 对象，不要 markdown 代码块、不要解释文字，直接以 { 开头：
{
  "card_title": "5-10 字的精炼标题，必须明显反映这张牌的内容和用户问题",
  "reflection": "回应用户问题的段落，引用牌中的具体概念",
  "connection": "这张牌和用户问题之间的具体关联",
  "question": "一个尖锐的、能刺痛的问题"
}`;

const SYSTEM_PROMPT_SINGLE_NO_QUESTION = `你是一个知识分析师。用户从个人知识库中随机抽到了一张塔罗牌，没有提出具体问题。

${STYLE_AND_BAN}

【输出格式】严格输出 JSON 对象，不要 markdown 代码块、不要解释文字，直接以 { 开头：
{
  "card_title": "5-10 字的精炼标题，必须明显反映这张牌的内容",
  "reflection": "这张牌的核心洞察，引用具体概念",
  "connection": "这个知识在日常生活中的具体映射",
  "question": "一个尖锐的、能刺痛的问题"
}`;

const SYSTEM_PROMPT_THREE = `你是一个知识分析师。用户从个人知识库中抽到了三张塔罗牌，构成"过去-现在-未来"牌阵。

${STYLE_AND_BAN}

【三牌阵额外要求】
- 在三张牌之间建立叙事弧线，识别张力、呼应或矛盾
- card_titles 必须是 3 个不同的字符串
- 每个标题必须明显反映该位置的牌的具体内容（不能照搬其他位置的标题，不能用通用短语糊弄）

【输出格式】严格输出 JSON 对象，不要 markdown 代码块、不要解释文字，直接以 { 开头：
{
  "card_titles": [
    "第一张牌（过去位置）的 5-10 字标题，反映这张牌的内容和用户问题",
    "第二张牌（现在位置）的 5-10 字标题，反映这张牌的内容和用户问题",
    "第三张牌（未来位置）的 5-10 字标题，反映这张牌的内容和用户问题"
  ],
  "past": "过去这张牌揭示的具体起点或根基",
  "present": "现在这张牌说明的具体处境或矛盾",
  "future": "未来这张牌指向的具体可能性",
  "narrative": "将三张牌编织成一个连贯叙事，展示从过去到未来的逻辑线",
  "question": "一个尖锐的、能刺痛的问题"
}`;

const SYSTEM_PROMPT_THREE_NO_QUESTION = `你是一个知识分析师。用户从个人知识库中随机抽到了三张塔罗牌，构成"过去-现在-未来"牌阵，没有提出具体问题。

${STYLE_AND_BAN}

【三牌阵额外要求】
- 在三张牌之间建立叙事弧线，识别张力、呼应或矛盾
- card_titles 必须是 3 个不同的字符串
- 每个标题必须明显反映该位置的牌的具体内容（不能照搬其他位置的标题，不能用通用短语糊弄）

【输出格式】严格输出 JSON 对象，不要 markdown 代码块、不要解释文字，直接以 { 开头：
{
  "card_titles": [
    "第一张牌（过去位置）的 5-10 字标题，反映这张牌的具体内容",
    "第二张牌（现在位置）的 5-10 字标题，反映这张牌的具体内容",
    "第三张牌（未来位置）的 5-10 字标题，反映这张牌的具体内容"
  ],
  "past": "过去这张牌揭示的具体起点或根基",
  "present": "现在这张牌说明的具体处境或矛盾",
  "future": "未来这张牌指向的具体可能性",
  "narrative": "将三张牌编织成一个连贯叙事",
  "question": "一个尖锐的、能刺痛的问题"
}`;

// ── Interpret ────────────────────────────────────────────
app.post('/api/interpret', async (req, res) => {
  const { question, cards } = req.body;

  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: 'Invalid input: cards required' });
  }

  const isThreeCard = cards.length === 3;

  if (!DEEPSEEK_API_KEY) {
    const fb = buildFallback(cards, isThreeCard);
    return res.status(503).json({
      body: fb,
      card_titles: isThreeCard ? fb.card_titles : (fb.card_title ? [fb.card_title] : []),
      source: 'fallback',
      warning: '未配置 DEEPSEEK_API_KEY，已返回模板化解读。'
    });
  }

  const hasQuestion = question && question.trim().length > 0;

  let systemPrompt;
  if (isThreeCard) {
    systemPrompt = hasQuestion ? SYSTEM_PROMPT_THREE : SYSTEM_PROMPT_THREE_NO_QUESTION;
  } else {
    systemPrompt = hasQuestion ? SYSTEM_PROMPT_SINGLE : SYSTEM_PROMPT_SINGLE_NO_QUESTION;
  }

  const prompt = buildPrompt(question, cards);

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: isThreeCard ? 3000 : 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    const { titles, body } = parseAIResponse(raw, cards.length);

    res.json({ body, card_titles: titles, source: 'ai' });
  } catch (error) {
    console.error('Interpretation error:', error.message);
    const fb = buildFallback(cards, isThreeCard);
    res.status(200).json({
      body: fb,
      card_titles: isThreeCard ? fb.card_titles : (fb.card_title ? [fb.card_title] : []),
      source: 'fallback',
      warning: 'AI 服务暂时不可用，以下是基于牌面信息的直接展示。'
    });
  }
});

function buildPrompt(question, cards) {
  const isThreeCard = cards.length === 3;
  const hasQuestion = question && question.trim().length > 0;
  let prompt = '';

  if (hasQuestion) {
    prompt += `用户问题：${question}\n\n`;
  } else {
    prompt += `用户没有提出具体问题，请根据牌的内容给出洞察。\n\n`;
  }

  if (isThreeCard) {
    prompt += `三牌阵 — 过去·现在·未来（请为每张牌生成一个独特的、明显反映该牌内容的标题）：\n\n`;
    cards.forEach((c) => {
      prompt += `【${c.positionName}】"${c.title}"\n`;
      prompt += `  核心主张：${c.summary}\n`;
      if (c.scenario) prompt += `  适用场景：${c.scenario}\n`;
      if (c.passage) prompt += `  原文节选：${c.passage.slice(0, 800)}\n`;
      prompt += `\n`;
    });
  } else {
    prompt += `日签（请为这张牌生成一个明显反映其内容的标题）：\n\n`;
    cards.forEach(c => {
      prompt += `"${c.title}"\n`;
      prompt += `  核心主张：${c.summary}\n`;
      if (c.scenario) prompt += `  适用场景：${c.scenario}\n`;
      if (c.passage) prompt += `  原文节选：${c.passage.slice(0, 800)}\n`;
    });
  }

  prompt += `\n请严格按照 system 指定的 JSON 格式输出，不要任何额外文字。`;
  return prompt;
}

function buildFallback(cards, isThreeCard) {
  if (isThreeCard) {
    return {
      card_titles: cards.map(c => c.title),
      past: cards[0]?.summary || '',
      present: cards[1]?.summary || '',
      future: cards[2]?.summary || '',
      narrative: '（未连接 AI，以下为知识库原文摘要）',
      question: ''
    };
  }
  const c = cards[0] || {};
  return {
    card_title: c.title || '',
    reflection: c.summary || '',
    connection: c.scenario || '',
    question: ''
  };
}

// 从 AI 响应中解析 JSON 并提取标题与正文
function parseAIResponse(raw, cardCount) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* noop */ }
    }
  }

  // JSON 解析失败：用字段级正则尽力救
  if (!parsed || typeof parsed !== 'object') {
    parsed = salvageFields(raw, cardCount);
  }

  let titles = [];
  if (cardCount === 1) {
    if (parsed.card_title) titles = [String(parsed.card_title).trim()];
  } else {
    if (Array.isArray(parsed.card_titles)) {
      titles = parsed.card_titles.map(s => String(s).trim()).filter(Boolean);
    }
  }

  return { titles, body: parsed };
}

// 兜底：JSON.parse 失败时（通常是字段值里有未转义的双引号），按字段名抓内容
function salvageFields(raw, cardCount) {
  const result = {};
  // 抓单字符串字段：从 "key": "...." 抓到下一个 ", "next_key" 或 } 之前
  const stringFields = cardCount === 1
    ? ['card_title', 'reflection', 'connection', 'question']
    : ['past', 'present', 'future', 'narrative', 'question'];

  for (const key of stringFields) {
    // 匹配 "key": "<内容>" —— 内容部分懒匹配到下一个 \n  ", 或 \n} 之前
    const re = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"|\\n?\\s*\\})`);
    const m = raw.match(re);
    if (m) result[key] = m[1].replace(/\\"/g, '"').trim();
  }

  // 抓 card_titles 数组（仅三牌阵）
  if (cardCount > 1) {
    const arrM = raw.match(/"card_titles"\s*:\s*\[([\s\S]*?)\]/);
    if (arrM) {
      const items = arrM[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) || [];
      result.card_titles = items.map(s => s.slice(1, -1).replace(/\\"/g, '"').trim()).filter(Boolean);
    }
  }

  // 完全没救出来则返回 _raw 让前端能 debug
  if (Object.keys(result).length === 0) return { _raw: raw };
  return result;
}

// ── Deep Explore ─────────────────────────────────────────
app.post('/api/deep-explore', async (req, res) => {
  const { question, card } = req.body;

  if (!card) {
    return res.status(400).json({ error: 'card required' });
  }

  if (!DEEPSEEK_API_KEY) {
    return res.json({
      content: null,
      source: 'fallback',
      message: 'AI 服务未配置'
    });
  }

  const prompt = buildDeepExplorePrompt(question, card);

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content: `你是一面知识之镜。用户正在深入探索一张知识塔罗牌。
你的任务是揭示这张牌的内容与用户问题之间的深层联系。

规则：
- 从原文中提取与问题最相关的2-3个要点
- 用"神秘启示"的口吻重新诠释这些要点
- 如果问题为空，则以"冥想式解读"的方式揭示知识的隐藏含义
- 去掉所有技术术语、标签、格式符号
- 输出不超过300字

输出格式：
<essence>这张牌的本质含义(1句话)</essence>
<relevance>与用户问题的关联解读(2-3段)</relevance>
<quote>原文中最有力的一句话(原样引用)</quote>`
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    // Parse structured output
    const essence = raw.match(/<essence>([\s\S]*?)<\/essence>/)?.[1]?.trim();
    const relevance = raw.match(/<relevance>([\s\S]*?)<\/relevance>/)?.[1]?.trim();
    const quote = raw.match(/<quote>([\s\S]*?)<\/quote>/)?.[1]?.trim();

    res.json({
      content: { essence, relevance, quote },
      source: 'ai'
    });
  } catch (error) {
    console.error('Deep explore error:', error.message);
    res.json({
      content: null,
      source: 'fallback',
      message: 'AI 深度解读暂时不可用'
    });
  }
});

function buildDeepExplorePrompt(question, card) {
  let prompt = `牌名："${card.title}"\n`;
  prompt += `花色：${card.suitName} | 牌型：${card.typeLabel}\n`;
  prompt += `核心主张：${card.summary}\n`;
  if (card.passage) {
    prompt += `\n原文节选：\n${card.passage.slice(0, 600)}\n`;
  }
  if (question) {
    prompt += `\n用户问题：${question}\n`;
  } else {
    prompt += `\n用户没有提出具体问题，请以冥想式解读的方式揭示这张牌的智慧。\n`;
  }
  return prompt;
}

// ── SPA fallback ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Knowledge Tarot server running at http://localhost:${PORT}`);
  console.log(`Privacy mode: ${DEEPSEEK_API_KEY ? 'Cloud available' : 'Local only (no API key)'}`);
});
