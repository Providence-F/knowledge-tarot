require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/data', express.static(path.join(__dirname, '..', 'data')));

app.post('/api/interpret', async (req, res) => {
  const { question, cards } = req.body;

  if (!question || !cards || !Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: 'question and cards are required' });
  }

  const apiKey = process.env.CLAUDE_API_KEY;

  if (apiKey) {
    try {
      const result = await callClaude(apiKey, question, cards);
      return res.json({ source: 'ai', interpretation: formatInterpretation(result) });
    } catch (err) {
      console.error('Claude API call failed, falling back to template:', err.message);
    }
  }

  const fallback = getFallbackInterpretation(question, cards);
  return res.json({ source: 'fallback', interpretation: fallback });
});

async function callClaude(apiKey, question, cards) {
  const systemPrompt = `你是"知识之镜"，一个帮助用户反思自身知识的塔罗解读助手。

你的核心原则：
- 综合用户已有的知识记录来解读，不给外部建议
- 帮助用户发现自己知识之间的联系与张力
- 以一个反思性问题结尾，引导用户自己找到答案

输出格式必须严格遵守：
<reflection>对问题与牌面的综合解读</reflection>
<connection>用户已有知识之间的联系或张力</connection>
<question>引导用户反思的问题</question>

示例：
问题："该专注实习还是做个人项目？"
牌1（过去）："逆向工程：从终局推导路径" — 核心主张：先定义终点，再反推路径
牌2（现在）："完美主义与启动延迟" — 核心主张：完美主义会导致4.5小时的启动空白期

<reflection>你在"实习"和"个人项目"之间犹豫，背后其实是两条路径的冲突：一条是跟着别人的需求走，一条是按自己的终局推导。</reflection>
<connection>你之前记录过"先定义终点，再反推路径"，但同时也观察到"完美主义会导致启动延迟"。这两条知识之间有一个张力：你在用终局思维规划，却同时被完美主义卡住了启动。你不是不知道方向，你是知道方向但不敢迈出第一步。</connection>
<question>如果去掉"完美"这个条件，你今天会选择哪条路？</question>`;

  const userMessage = buildPrompt(question, cards);

  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'mimo-v2.5-pro',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  const reflection = text.match(/<reflection>([\s\S]*?)<\/reflection>/)?.[1]?.trim() || '';
  const connection = text.match(/<connection>([\s\S]*?)<\/connection>/)?.[1]?.trim() || '';
  const questionText = text.match(/<question>([\s\S]*?)<\/question>/)?.[1]?.trim() || '';

  return { reflection, connection, question: questionText, raw: text };
}

function buildPrompt(question, cards) {
  const cardDescriptions = cards.map((card, i) => {
    const position = card.positionLabel || card.position || `牌${i + 1}`;
    let desc = `牌${i + 1}（${position}）：「${card.title}」`;
    desc += `\n- 核心主张：${card.summary || '无'}`;
    if (card.scenario) desc += `\n- 适用场景：${card.scenario}`;
    if (card.keyPoints && card.keyPoints.length > 0) {
      desc += `\n- 关键要点：`;
      for (const kp of card.keyPoints.slice(0, 5)) {
        desc += `\n  · ${kp}`;
      }
    }
    return desc;
  }).join('\n\n');

  return `问题："${question}"
${cardDescriptions}

请根据以上牌面信息，引用用户的具体知识要点进行解读。不要泛泛而谈，要展示这些知识之间的具体联系。`;
}

function formatInterpretation(result) {
  if (result.reflection || result.connection || result.question) {
    let text = '';
    if (result.reflection) text += result.reflection + '\n\n';
    if (result.connection) text += result.connection + '\n\n';
    if (result.question) text += result.question;
    return text.trim();
  }
  return result.raw || '解读生成失败，请重试。';
}

function getFallbackInterpretation(question, cards) {
  const cardReadings = cards.map((card, i) => {
    const position = card.positionLabel || card.position || `牌${i + 1}`;
    let text = `【${position}】${card.title}\n${card.summary || ''}`;
    if (card.scenario) text += `\n适用：${card.scenario}`;
    if (card.keyPoints && card.keyPoints.length > 0) {
      text += '\n' + card.keyPoints.slice(0, 3).map(kp => `  · ${kp}`).join('\n');
    }
    return text;
  }).join('\n\n');

  return `你问的是：「${question}」\n\n${cardReadings}`;
}

app.listen(PORT, () => {
  console.log(`Knowledge Tarot server running on http://localhost:${PORT}`);
});
