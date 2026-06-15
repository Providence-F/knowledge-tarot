/**
 * src/adapters/textdump.js — 任意 .md/.txt 文件夹 / 单文件 / 粘贴文本
 * 输出统一的 RawItem[]
 */

const fs = require('fs');
const path = require('path');
const { hashId } = require('../utils');

function loadFromPath(rootPath) {
  const items = [];
  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    pushFile(rootPath, path.basename(rootPath), items);
  } else if (stat.isDirectory()) {
    walk(rootPath, '', items);
  }
  return items;
}

function loadFromText(text, label = 'pasted', opts = {}) {
  if (!text || !text.trim()) return [];
  const splitMode = opts.split !== false;  // 默认按段落切

  if (!splitMode) {
    return [{
      id: hashId('textdump', label, text.slice(0, 100)),
      body: text,
      title: label,
      createdAt: Date.now(),
      sourceMeta: { type: 'textdump', label }
    }];
  }

  // 按双换行切段，太短的合并到下一段
  const segments = splitIntoSegments(text);
  return segments.map((seg, i) => ({
    id: hashId('textdump', label, i, seg.slice(0, 60)),
    body: seg,
    title: label + (segments.length > 1 ? ` #${i + 1}` : ''),
    createdAt: Date.now(),
    sourceMeta: { type: 'textdump', label, segmentIndex: i }
  }));
}

function splitIntoSegments(text) {
  // 优先按双换行（段落分隔）切
  const rough = text.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);

  // 合并过短的段（< 50 字）到下一段
  const merged = [];
  let buf = '';
  for (const seg of rough) {
    if (seg.length < 50) {
      buf = buf ? buf + '\n\n' + seg : seg;
      continue;
    }
    if (buf) {
      merged.push(buf + '\n\n' + seg);
      buf = '';
    } else {
      merged.push(seg);
    }
  }
  if (buf) {
    if (merged.length > 0) {
      merged[merged.length - 1] += '\n\n' + buf;
    } else {
      merged.push(buf);
    }
  }

  // 极长段（> 2000 字）按句号再细切
  const final = [];
  for (const seg of merged) {
    if (seg.length <= 2000) {
      final.push(seg);
    } else {
      // 按"。！？\n"切，凑到 800-1500 字一段
      const sents = seg.split(/(?<=[。！？\n])/);
      let chunk = '';
      for (const s of sents) {
        if ((chunk + s).length > 1200 && chunk) {
          final.push(chunk.trim());
          chunk = s;
        } else {
          chunk += s;
        }
      }
      if (chunk.trim()) final.push(chunk.trim());
    }
  }

  return final.length > 0 ? final : [text];
}

function walk(dir, relBase, items) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = relBase ? path.posix.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      walk(fullPath, relPath, items);
    } else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
      pushFile(fullPath, relPath, items);
    }
  }
}

function pushFile(fullPath, relPath, items) {
  let body;
  try {
    body = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return;
  }
  if (!body.trim()) return;
  const stat = fs.statSync(fullPath);
  const filename = path.basename(relPath, path.extname(relPath));
  items.push({
    id: hashId('textdump', relPath),
    body,
    title: filename,
    createdAt: stat.birthtimeMs || stat.ctimeMs,
    updatedAt: stat.mtimeMs,
    sourceMeta: { type: 'textdump', path: relPath }
  });
}

module.exports = {
  name: 'textdump',
  loadFromPath,
  loadFromText
};
