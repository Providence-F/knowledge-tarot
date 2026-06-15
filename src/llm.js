/**
 * src/llm.js — DeepSeek 客户端封装
 * 提供：JSON 模式调用、超时、单次重试、字段级容错
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = 'https://api.deepseek.com/v1';

async function callJSON(systemPrompt, userPrompt, opts = {}) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not set');

  const body = {
    model: opts.model || 'deepseek-chat',
    max_tokens: opts.maxTokens || 1500,
    temperature: opts.temperature ?? 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  const timeoutMs = opts.timeoutMs || 60000;
  const maxAttempts = opts.maxAttempts || 2;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || '{}';
      return parseJSONSafely(raw);
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

function parseJSONSafely(raw) {
  try { return JSON.parse(raw); } catch { /* fall */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* fall */ }
  }
  return { _raw: raw, _parseError: true };
}

module.exports = { callJSON };
