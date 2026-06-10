const express = require('express');
const path = require('path');
const fs = require('fs');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// CORS for local dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Parse JSON body
app.use(express.json());

// Serve static files from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// GET /api/cards — serve card index
app.get('/api/cards', (req, res) => {
  const cardsPath = path.join(__dirname, '..', 'data', 'cards.json');
  if (!fs.existsSync(cardsPath)) {
    return res.status(404).json({ error: 'cards.json not found. Run "npm run build" first.' });
  }
  try {
    const data = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse cards.json' });
  }
});

// POST /api/interpret — AI interpretation via Claude API
app.post('/api/interpret', async (req, res) => {
  const { question, cards, privacyMode } = req.body;

  // Input validation
  if (!question || !cards || !Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: 'Missing question or cards' });
  }

  // Local mode should not reach here
  if (privacyMode === 'local') {
    return res.status(400).json({ error: 'Cloud interpretation not available in local mode' });
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    return res.json(buildFallback(question, cards, 'API key not configured'));
  }

  // Build the few-shot prompt
  const cardDescriptions = cards
    .map(c => `牌${c.position}：「${c.title}」 — ${c.summary}（适用场景：${c.scenario}）`)
    .join('\n');

  const userPrompt = `问题："${question}"\n${cardDescriptions}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'mimo-v2.5-pro',
        max_tokens: 1000,
        stream: true,
        system: `你是一面知识之镜。用户从个人知识库中抽到了塔罗牌。
你的任务是帮他们看到自己的智慧与当前问题之间的关联。
不要添加外部建议。不要给出行动指令。只综合用户已有的知识。
始终以反思性问题结尾。

输出格式（严格遵守）：
<reflection>回应用户问题的段落</reflection>
<connection>展示这些智慧之间关联的段落</connection>
<question>一个反思性问题（不是答案）</question>

示例输入：
问题："该专注实习还是做个人项目？"
牌1（过去）："逆向工程：从终局推导路径" — 核心主张：先定义终点，再反推路径
牌2（现在）："完美主义与启动延迟" — 核心主张：完美主义会导致4.5小时的启动空白期

示例输出：
<reflection>你在"实习"和"个人项目"之间犹豫，背后其实是两条路径的冲突：一条是跟着别人的需求走，一条是按自己的终局推导。</reflection>
<connection>你之前记录过"先定义终点，再反推路径"，但同时也观察到"完美主义会导致启动延迟"。这两条知识之间有一个张力：你在用终局思维规划，却同时被完美主义卡住了启动。你不是不知道方向，你是知道方向但不敢迈出第一步。</connection>
<question>如果去掉"完美"这个条件，你今天会选择哪条路？</question>`,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API ${response.status}: ${errText}`);
    }

    // Stream SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              res.write(`data: ${JSON.stringify({ type: 'text', text: parsed.delta.text })}\n\n`);
            }
          } catch (e) {
            // skip unparseable chunks
          }
        }
      }
    }

    res.end();
  } catch (err) {
    // If headers already sent (SSE started), just end
    if (res.headersSent) {
      res.end();
      return;
    }

    const warning = err.name === 'AbortError'
      ? 'AI request timed out'
      : `AI error: ${err.message}`;

    console.error('[interpret]', warning);
    res.json(buildFallback(question, cards, warning));
  }
});

// Build fallback interpretation
function buildFallback(question, cards, warning) {
  const text = cards
    .map(c => `【${c.position}】${c.title}\n${c.summary}\n适用：${c.scenario}`)
    .join('\n\n');

  return {
    interpretation: `<reflection>你提出了一个值得深思的问题。让我们看看你抽到的知识牌。</reflection>\n<connection>\n${text}\n</connection>\n<question>这些知识之间有什么联系？它们如何回应你的问题？</question>`,
    source: 'fallback',
    warning,
  };
}

app.listen(PORT, () => {
  console.log(`Knowledge Tarot server running at http://localhost:${PORT}`);
});
