#!/usr/bin/env node
/**
 * Knowledge Tarot — Build Deck
 * 解析 Obsidian 知识库，生成 cards.json
 */

const fs = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'suit-mapping.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'cards.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const KB_PATH = config.knowledgeBasePath;
const EXCLUDE_DIRS = new Set(config.excludeDirs);
const ARCANA_MAP = config.arcanaMap;
const DEFAULT_ARCANA = config.defaultArcana;
const TYPE_PATTERNS = config.cardTypes.map(t => ({
  ...t,
  regex: new RegExp(t.pattern)
}));

// ── Stats ────────────────────────────────────────────────
const stats = {
  totalFiles: 0,
  success: 0,
  failed: 0,
  noFrontmatter: 0,
  fallbackToBlockquote: 0,
  fallbackToTitle: 0,
  suitDistribution: {},
  typeDistribution: {},
  arcanaDistribution: {},
  errors: []
};

config.suits.forEach(s => stats.suitDistribution[s.id] = 0);

// ── Helpers ──────────────────────────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const raw = match[1];
  const fm = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
    if (m) {
      let key = m[1].trim();
      let val = m[2].trim();
      // array: [a, b, c]
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

function cleanMarkdown(text) {
  return text
    .replace(/%%.*?%%/gs, '')           // Obsidian comments
    .replace(/\^[a-zA-Z0-9\-]+/g, '')   // block ref IDs
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')  // [[A|B]] -> B
    .replace(/\[\[([^\]]+)\]\]/g, '$1')              // [[A]] -> A
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')         // [text](url) -> text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')          // images
    .replace(/[*#`>\-]/g, '')           // rough cleanup for fallback
    .replace(/\s+/g, ' ')
    .trim();
}

// 按语义边界截断文本（句子、逗号、段落）
function truncateAtBoundary(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  // 优先在句子结束符处截断
  const lastPeriod = Math.max(
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('！'),
    truncated.lastIndexOf('？'),
    truncated.lastIndexOf('\n')
  );
  if (lastPeriod > maxLen * 0.6) {
    return truncated.slice(0, lastPeriod + 1);
  }
  // 其次在逗号或分号处截断
  const lastComma = Math.max(
    truncated.lastIndexOf('，'),
    truncated.lastIndexOf('；'),
    truncated.lastIndexOf('、')
  );
  if (lastComma > maxLen * 0.7) {
    return truncated.slice(0, lastComma + 1);
  }
  // 都找不到，硬截断加省略号
  return truncated + '...';
}

function cleanForDisplay(text) {
  return text
    .replace(/%%.*?%%/gs, '')
    .replace(/\^[a-zA-Z0-9\-]+/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^#{1,6}\s+/gm, '')        // 移除行首的 # 标记
    .replace(/^>\s*/gm, '')              // 移除行首的 > 标记
    .replace(/\*\*(.+?)\*\*/g, '$1')     // 移除 ** 粗体标记
    .replace(/\*(.+?)\*/g, '$1')         // 移除 * 斜体标记
    .replace(/^[-*]\s+/gm, '')           // 移除行首的列表标记
    .replace(/^\d+\.\s+/gm, '')          // 移除有序列表标记
    .replace(/\r\n/g, '\n')              // 统一换行符
    .replace(/\n{3,}/g, '\n\n')          // 压缩多余空行
    .trim();
}

function extractCoreClaim(content, frontmatter) {
  // 1. exact: > **核心主张**：xxx
  const exact = content.match(/>\s*\*\*核心主张\*\*[：:]\s*(.+)/);
  if (exact) return cleanForDisplay(exact[1]).slice(0, 300);

  // 2. fuzzy: blockquote contains 核心主张
  const fuzzy = content.match(/> .*核心主张.*[：:]\s*(.+)/);
  if (fuzzy) return cleanForDisplay(fuzzy[1]).slice(0, 300);

  // 3. first blockquote
  const firstQuote = content.match(/>\s*(.+)/);
  if (firstQuote) {
    stats.fallbackToBlockquote++;
    return cleanForDisplay(firstQuote[1]).slice(0, 300);
  }

  // 4. final fallback
  stats.fallbackToTitle++;
  return (frontmatter?.title || content.slice(0, 120)).replace(/[#*`>\-]/g, '').trim();
}

function extractScenario(content) {
  const exact = content.match(/>\s*\*\*适用场景\*\*[：:]\s*(.+)/);
  if (exact) return cleanForDisplay(exact[1]).slice(0, 300);
  const fuzzy = content.match(/> .*适用场景.*[：:]\s*(.+)/);
  if (fuzzy) return cleanForDisplay(fuzzy[1]).slice(0, 300);
  return '';
}

function extractPassage(content) {
  const sectionMatch = content.match(/#{2,3}\s*核心洞察\s*\r?\n([\s\S]*?)(?=\r?\n#{2,3}\s|\r?\n---|\Z)/);
  if (sectionMatch) {
    return truncateAtBoundary(cleanForDisplay(sectionMatch[1]), 800);
  }
  const body = content.replace(/^---[\s\S]*?---\r?\n/, '').replace(/^#.+\r?\n/, '');
  return truncateAtBoundary(cleanForDisplay(body), 500);
}

function extractKeyInsight(content, frontmatter) {
  // Strategy 1: Find "核心洞察" section and extract bullet points
  const insightSection = content.match(
    /#{2,3}\s*核心洞察\s*\r?\n([\s\S]*?)(?=\r?\n#{2,3}\s|\r?\n---|\Z)/
  );
  if (insightSection) {
    const cleaned = cleanForDisplay(insightSection[1]);
    const points = cleaned.split(/\n/)
      .map(l => l.replace(/^[-*]\s*/, '').trim())
      .filter(l => l.length > 10 && l.length < 200 && !l.startsWith('#'))
      .slice(0, 3);
    if (points.length > 0) return points;
  }

  // Strategy 2: Find explicit "核心主张" with context
  const claimMatch = content.match(
    />\s*\*\*核心主张\*\*[：:]\s*(.+)/
  );
  if (claimMatch) {
    return [cleanForDisplay(claimMatch[1]).slice(0, 200)];
  }

  // Strategy 3: Find meaningful blockquotes
  const quotes = [...content.matchAll(/>\s*(.+)/g)]
    .map(m => cleanForDisplay(m[1]))
    .filter(q => q.length > 15 && q.length < 200 && !q.match(/^(研究日期|来源|日期|创建|更新|###)/))
    .slice(0, 3);
  if (quotes.length > 0) return quotes;

  // Strategy 4: Find bold text as key points
  const bolds = [...content.matchAll(/\*\*(.+?)\*\*/g)]
    .map(m => cleanForDisplay(m[1]))
    .filter(b => b.length > 4 && b.length < 50 && !b.match(/核心主张|适用场景|来源|相关|###/))
    .slice(0, 3);
  if (bolds.length > 0) return bolds;

  return null;
}

function extractStructuredPassage(content) {
  const sections = [];

  // 1. Core claim
  const claim = content.match(/>\s*\*\*核心主张\*\*[：:]\s*(.+)/);
  if (claim) {
    sections.push({ type: 'claim', text: truncateAtBoundary(cleanForDisplay(claim[1]), 300) });
  }

  // 2. Core insight section
  const insight = content.match(
    /#{2,3}\s*核心洞察\s*\r?\n([\s\S]*?)(?=\r?\n#{2,3}\s|\r?\n---|\Z)/
  );
  if (insight) {
    sections.push({ type: 'insight', text: truncateAtBoundary(cleanForDisplay(insight[1]), 500) });
  }

  // 3. Applicable scenarios
  const scenario = content.match(/>\s*\*\*适用场景\*\*[：:]\s*(.+)/);
  if (scenario) {
    sections.push({ type: 'scenario', text: truncateAtBoundary(cleanForDisplay(scenario[1]), 300) });
  }

  return sections.length > 0 ? sections : null;
}

function extractWikilinks(content) {
  const links = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    links.push(m[1].trim());
  }
  return [...new Set(links)];
}

function detectCardType(filename) {
  for (const tp of TYPE_PATTERNS) {
    if (tp.regex.test(filename)) return { type: tp.type, label: tp.label };
  }
  return { type: 'note', label: '笔记牌' };
}

function getSuit(relPath) {
  const parts = relPath.split(/[\\/]/);
  const topDir = parts[0];
  for (const suit of config.suits) {
    if (suit.directories.includes(topDir)) return suit;
  }
  return null;
}

function getArcana(status) {
  if (!status) return DEFAULT_ARCANA;
  return ARCANA_MAP[status] || DEFAULT_ARCANA;
}

// ── Main Walker ──────────────────────────────────────────

function walk(dir, relBase = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = relBase ? path.posix.join(relBase, entry.name) : entry.name;

    if (entry.isDirectory()) {
      walk(fullPath, relPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      processFile(fullPath, relPath);
    }
  }
}

function processFile(fullPath, relPath) {
  stats.totalFiles++;
  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch (e) {
    stats.failed++;
    stats.errors.push({ file: relPath, reason: 'read_error', detail: e.message });
    return;
  }

  const suit = getSuit(relPath);
  if (!suit) {
    // 不属于五花色的笔记（如 00-元数据、08-人脉、09-收件箱、11-系统）
    return;
  }

  const frontmatterResult = parseFrontmatter(content);
  if (!frontmatterResult) {
    stats.noFrontmatter++;
  }
  const fm = frontmatterResult?.fm || {};
  const bodyStart = frontmatterResult?.endIndex || 0;
  const body = content.slice(bodyStart);

  const filename = path.basename(relPath, '.md');
  const cardType = detectCardType(filename);
  const arcana = getArcana(fm.status);

  const title = fm.title || filename.replace(/[-_]/g, ' ');
  const summary = extractCoreClaim(body, fm);
  const scenario = extractScenario(body);
  const passage = extractPassage(content);
  const keyInsights = extractKeyInsight(body, fm);
  const structuredSections = extractStructuredPassage(content);
  const wikilinks = extractWikilinks(content);
  const tags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []);

  const stat = fs.statSync(fullPath);

  const card = {
    id: relPath.replace(/[\\/]/g, '-').replace(/\.md$/, ''),
    title: title.slice(0, 200),
    filename,
    path: relPath,
    suit: suit.id,
    suitName: suit.name,
    type: cardType.type,
    typeLabel: cardType.label,
    arcana,
    summary,
    scenario,
    passage,
    keyInsights,
    structuredSections,
    tags,
    wikilinks,
    status: fm.status || 'seed',
    date: fm.date || null,
    private: fm.private === true || fm.private === 'true',
    mtime: stat.mtime.toISOString(),
    ctime: stat.ctime.toISOString(),
    wordCount: body.replace(/\s/g, '').length
  };

  cards.push(card);
  stats.success++;
  stats.suitDistribution[suit.id] = (stats.suitDistribution[suit.id] || 0) + 1;
  stats.typeDistribution[cardType.type] = (stats.typeDistribution[cardType.type] || 0) + 1;
  stats.arcanaDistribution[arcana] = (stats.arcanaDistribution[arcana] || 0) + 1;
}

// ── Run ──────────────────────────────────────────────────

const cards = [];
walk(KB_PATH);

// Sort: by suit, then by title
cards.sort((a, b) => {
  if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
  return a.title.localeCompare(b.title);
});

// Write output
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
  meta: {
    generatedAt: new Date().toISOString(),
    sourcePath: KB_PATH,
    totalCards: cards.length
  },
  cards
}, null, 2));

// ── Report ───────────────────────────────────────────────

const successRate = stats.totalFiles > 0 ? ((stats.success / stats.totalFiles) * 100).toFixed(1) : '0.0';

console.log('\n=== 知识塔罗构建报告 ===');
console.log(`总文件: ${stats.totalFiles}`);
console.log(`成功提取: ${stats.success} (${successRate}%)`);
console.log(`失败: ${stats.failed}`);
console.log(`  - 无 frontmatter: ${stats.noFrontmatter}`);
console.log(`  - 核心主张回退到 blockquote: ${stats.fallbackToBlockquote}`);
console.log(`  - 核心主张回退到 title/文件名: ${stats.fallbackToTitle}`);
console.log('');
console.log('花色分布:');
for (const suit of config.suits) {
  const count = stats.suitDistribution[suit.id] || 0;
  console.log(`  ${suit.name}(${suit.id}): ${count}`);
}
console.log('');
console.log('牌型分布:');
Object.entries(stats.typeDistribution).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
  console.log(`  ${type}: ${count}`);
});
console.log('');
console.log('牌位分布:');
Object.entries(stats.arcanaDistribution).sort((a, b) => b[1] - a[1]).forEach(([arcana, count]) => {
  console.log(`  ${arcana}: ${count}`);
});
console.log('');

if (stats.errors.length > 0) {
  console.log('错误详情:');
  stats.errors.slice(0, 10).forEach(e => console.log(`  ${e.file}: ${e.reason} - ${e.detail}`));
}

console.log(`\n输出: ${OUTPUT_PATH}`);
console.log(`牌组大小: ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1)} KB`);
