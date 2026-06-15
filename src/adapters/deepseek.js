/**
 * src/adapters/deepseek.js — DeepSeek 历史对话适配器
 *
 * 输入：DeepSeek 官方导出的 conversations.json
 *   结构：[{ id, title, inserted_at, mapping: { id: { message: { fragments: [{type, content}] } } } }, ...]
 *
 * fragment.type:
 *   - REQUEST  → 用户消息
 *   - RESPONSE → AI 回复
 *   - THINK    → 跳过（DeepSeek-R1 的推理思考过程，不进牌堆）
 *   - SEARCH   → 跳过（联网搜索元数据）
 *
 * 每个 conversation = 一个 RawItem，body 是 markdown 拼接的对话。
 */

const { hashId } = require('../utils');

function loadFromJSON(jsonStr) {
  let parsed;
  try {
    parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  } catch (e) {
    throw new Error('DeepSeek 导出文件不是合法 JSON: ' + e.message);
  }

  const list = Array.isArray(parsed) ? parsed : parsed.conversations;
  if (!Array.isArray(list)) {
    throw new Error('未识别的 DeepSeek 导出结构（期望 conversations 数组）');
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
  const insertedAt = conv.inserted_at || conv.created_at;
  const updatedAt = conv.updated_at;
  const createdAt = parseTime(insertedAt) || Date.now();

  // 顺着 root → children 链遍历，按对话顺序提取 fragments
  const messages = walkMapping(conv.mapping);
  if (messages.length === 0) return null;

  const body = messages.map(m => {
    const speaker = m.role === 'user' ? '我' : 'AI';
    return `**${speaker}**：${m.text}`;
  }).join('\n\n');

  if (body.length < 30) return null;

  return {
    id: hashId('deepseek', conv.id || title, createdAt),
    body,
    title,
    createdAt,
    updatedAt: parseTime(updatedAt) || createdAt,
    sourceMeta: {
      type: 'deepseek',
      conversationId: conv.id || null,
      messageCount: messages.length,
      title
    }
  };
}

function walkMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return [];

  const messages = [];
  const visited = new Set();

  function walk(nodeId) {
    if (!nodeId || visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = mapping[nodeId];
    if (!node) return;

    if (node.message?.fragments) {
      let userPart = '';
      let aiPart = '';
      for (const f of node.message.fragments) {
        if (f.type === 'REQUEST') userPart += (userPart ? '\n' : '') + (f.content || '').trim();
        else if (f.type === 'RESPONSE') aiPart += (aiPart ? '\n' : '') + (f.content || '').trim();
        // THINK / SEARCH 直接跳过
      }
      if (userPart) messages.push({ role: 'user', text: userPart });
      if (aiPart) messages.push({ role: 'assistant', text: aiPart });
    }

    const children = node.children;
    if (Array.isArray(children)) {
      // 取第一个 child 作主线（DeepSeek 通常没有分支）
      for (const cid of children) walk(cid);
    }
  }

  walk('root');

  // 兜底：如果 root 走法没拿到任何消息（结构异常），按 mapping 顺序遍历
  if (messages.length === 0) {
    for (const node of Object.values(mapping)) {
      if (!node?.message?.fragments) continue;
      let userPart = '', aiPart = '';
      for (const f of node.message.fragments) {
        if (f.type === 'REQUEST') userPart += (userPart ? '\n' : '') + (f.content || '').trim();
        else if (f.type === 'RESPONSE') aiPart += (aiPart ? '\n' : '') + (f.content || '').trim();
      }
      if (userPart) messages.push({ role: 'user', text: userPart });
      if (aiPart) messages.push({ role: 'assistant', text: aiPart });
    }
  }

  return messages;
}

function parseTime(t) {
  if (!t) return null;
  if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
  if (typeof t === 'string') {
    const ms = Date.parse(t);
    return isNaN(ms) ? null : ms;
  }
  return null;
}

module.exports = { name: 'deepseek', loadFromJSON };
