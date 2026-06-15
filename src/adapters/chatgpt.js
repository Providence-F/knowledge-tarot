/**
 * src/adapters/chatgpt.js — ChatGPT 历史对话适配器
 *
 * 输入：ChatGPT 官方导出的 conversations.json
 *   结构：[{ title, create_time, mapping: { uuid: { message: { content: { parts: [...] }, author: { role } } } } }, ...]
 *
 * 策略：每个 conversation = 一个 RawItem
 *   - body = 把 user/assistant 消息拼成 markdown 对话（保留双方语境，AI 才能正确分诊）
 *   - title = conversation.title
 *   - createdAt = conversation.create_time
 */

const { hashId } = require('../utils');

function loadFromJSON(jsonStr) {
  let parsed;
  try {
    parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  } catch (e) {
    throw new Error('ChatGPT 导出文件不是合法 JSON: ' + e.message);
  }

  // 兼容两种导出格式：① 顶层是数组（标准 conversations.json）；② { conversations: [...] }
  const list = Array.isArray(parsed) ? parsed : parsed.conversations;
  if (!Array.isArray(list)) {
    throw new Error('未识别的 ChatGPT 导出结构（应该是 conversations 数组）');
  }

  const items = [];
  for (const conv of list) {
    const item = convertConversation(conv);
    if (item) items.push(item);
  }
  return items;
}

function convertConversation(conv) {
  if (!conv || typeof conv !== 'object') return null;

  const title = conv.title || '未命名对话';
  const createTime = conv.create_time || conv.created_at;
  const createdAt = typeof createTime === 'number' ? createTime * 1000 : Date.now();

  // mapping 结构：从 root 顺着 children 走能拿到一条消息线
  // 简化处理：直接按 create_time 排序所有 message
  const messages = [];
  if (conv.mapping && typeof conv.mapping === 'object') {
    for (const node of Object.values(conv.mapping)) {
      const msg = node?.message;
      if (!msg) continue;
      const role = msg.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const parts = msg.content?.parts;
      if (!Array.isArray(parts) || parts.length === 0) continue;
      const text = parts.filter(p => typeof p === 'string').join('\n').trim();
      if (!text) continue;
      messages.push({
        role,
        text,
        time: msg.create_time || 0
      });
    }
  } else if (Array.isArray(conv.messages)) {
    // 备用结构（部分第三方导出）
    for (const m of conv.messages) {
      const role = m.role || m.author;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = (typeof m.content === 'string' ? m.content : (m.text || '')).trim();
      if (!text) continue;
      messages.push({ role, text, time: m.create_time || 0 });
    }
  }

  if (messages.length === 0) return null;
  messages.sort((a, b) => (a.time || 0) - (b.time || 0));

  // 拼成 markdown
  const body = messages.map(m => {
    const speaker = m.role === 'user' ? '我' : 'AI';
    return `**${speaker}**：${m.text}`;
  }).join('\n\n');

  if (body.length < 30) return null;

  return {
    id: hashId('chatgpt', conv.id || conv.conversation_id || title, createdAt),
    body,
    title,
    createdAt,
    sourceMeta: {
      type: 'chatgpt',
      conversationId: conv.id || conv.conversation_id || null,
      messageCount: messages.length,
      title
    }
  };
}

module.exports = { name: 'chatgpt', loadFromJSON };
