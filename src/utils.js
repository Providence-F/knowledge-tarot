/**
 * src/utils.js — 共享工具：markdown 清洗、长度截断、frontmatter 解析
 * 从原 scripts/build-deck.js 抽取，保持行为完全一致
 */

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const raw = match[1];
  const fm = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      let val = m[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        try {
          val = JSON.parse(val.replace(/'/g, '"'));
        } catch {
          val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        }
      }
      fm[key] = val;
    }
  }
  return { fm, endIndex: match[0].length };
}

function cleanForDisplay(text) {
  return text
    .replace(/%%.*?%%/gs, '')
    .replace(/\^[a-zA-Z0-9\-]+/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateAtBoundary(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastPeriod = Math.max(
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('！'),
    truncated.lastIndexOf('？'),
    truncated.lastIndexOf('\n')
  );
  if (lastPeriod > maxLen * 0.6) return truncated.slice(0, lastPeriod + 1);
  const lastComma = Math.max(
    truncated.lastIndexOf('，'),
    truncated.lastIndexOf('；'),
    truncated.lastIndexOf('、')
  );
  if (lastComma > maxLen * 0.7) return truncated.slice(0, lastComma + 1);
  return truncated + '...';
}

function extractWikilinks(content) {
  const links = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = re.exec(content)) !== null) links.push(m[1].trim());
  return [...new Set(links)];
}

function hashId(...parts) {
  const s = parts.join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

module.exports = {
  parseFrontmatter,
  cleanForDisplay,
  truncateAtBoundary,
  extractWikilinks,
  hashId
};
