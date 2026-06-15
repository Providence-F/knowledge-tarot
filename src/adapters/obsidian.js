/**
 * src/adapters/obsidian.js — Obsidian vault 适配器
 * 沿用原 build-deck.js 的 walk + frontmatter 逻辑，输出 RawItem[]
 * 注意：本 adapter 不做花色过滤（旧逻辑会丢弃非五花色目录的笔记）——
 *      Layer 2/3 自己决定要不要某条内容，Adapter 只负责把内容拿出来。
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, hashId } = require('../utils');

const DEFAULT_EXCLUDE = new Set([
  '.obsidian', '.trash', '.git', '.vscode', '.smart-env',
  '.search', '.claude', '.cleanup-backup', 'node_modules'
]);

function loadFromVault(vaultPath, options = {}) {
  const excludeDirs = new Set([
    ...DEFAULT_EXCLUDE,
    ...(options.excludeDirs || [])
  ]);
  const items = [];
  walk(vaultPath, '', items, excludeDirs);
  return items;
}

function walk(dir, relBase, items, excludeDirs) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludeDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = relBase ? path.posix.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      walk(fullPath, relPath, items, excludeDirs);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      pushFile(fullPath, relPath, items);
    }
  }
}

function pushFile(fullPath, relPath, items) {
  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return;
  }
  if (!content.trim()) return;

  const fmResult = parseFrontmatter(content);
  const fm = fmResult?.fm || {};
  const bodyStart = fmResult?.endIndex || 0;
  const body = content.slice(bodyStart);

  const stat = fs.statSync(fullPath);
  const filename = path.basename(relPath, '.md');
  const tags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []);

  items.push({
    id: hashId('obsidian', relPath),
    body,
    title: fm.title || filename.replace(/[-_]/g, ' '),
    createdAt: stat.birthtimeMs || stat.ctimeMs,
    updatedAt: stat.mtimeMs,
    tags,
    sourceMeta: {
      type: 'obsidian',
      path: relPath,
      filename,
      frontmatter: fm,
      rawContent: content  // 给 ObsidianRegexExtractor 用，不进 DB
    }
  });
}

module.exports = {
  name: 'obsidian',
  loadFromVault
};
