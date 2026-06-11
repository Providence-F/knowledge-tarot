const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'suit-mapping.json');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'cards.json');
const REPORT_PATH = path.join(DATA_DIR, 'build-report.txt');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function walkMarkdownFiles(dir, skipDirs, baseDir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      results.push(...walkMarkdownFiles(fullPath, skipDirs, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push({ fullPath, relativePath, fileName: entry.name });
    }
  }
  return results;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: content };
  const raw = match[1];
  const fm = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^(\w+)\s*:\s*(.+)/);
    if (m) {
      let val = m[2].trim().replace(/^["']|["']$/g, '');
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      fm[m[1]] = val;
    }
  }
  const body = content.slice(match[0].length).trim();
  return { frontmatter: fm, body };
}

function cleanContent(text) {
  let s = text;
  s = s.replace(/%%[\s\S]*?%%/g, '');
  s = s.replace(/\^[a-zA-Z0-9_-]+/g, '');
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/^>\s?/gm, '');
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function extractBlockquotes(body) {
  const lines = body.split('\n');
  const quotes = [];
  let current = [];
  for (const line of lines) {
    if (line.match(/^\s*>\s?/)) {
      current.push(line.replace(/^\s*>\s?/, ''));
    } else {
      if (current.length > 0) {
        quotes.push(current.join('\n').trim());
        current = [];
      }
    }
  }
  if (current.length > 0) quotes.push(current.join('\n').trim());
  return quotes;
}

function extractCoreClaimSentence(body) {
  // 1. > **核心主张**：xxx
  const m1 = body.match(/>\s*\*\*核心主张\*\*\s*[：:]\s*(.+)/);
  if (m1) return m1[1].trim().replace(/\*\*/g, '').slice(0, 120);
  // 2. 模糊匹配
  const m2 = body.match(/> .*核心主张.*[：:]\s*(.+)/);
  if (m2) return m2[1].trim().replace(/\*\*/g, '').slice(0, 120);
  return '';
}

function extractTitle(body, frontmatter, fileName) {
  // 1. 核心主张句（精简为牌名）
  const claim = extractCoreClaimSentence(body);
  if (claim) {
    // 取核心主张的最后一句（通常是最精炼的结论）
    const sentences = claim.split(/[。，；]/).filter(s => s.trim().length > 2);
    if (sentences.length > 0) {
      const last = sentences[sentences.length - 1].trim();
      if (last.length >= 4 && last.length <= 50) return last;
      // 如果最后一句太长，取前 50 字
      return claim.slice(0, 50);
    }
    return claim.slice(0, 50);
  }
  // 2. 第一个 H2/H3 小标题
  const headingMatch = body.match(/^#{2,3}\s+(.+)/m);
  if (headingMatch) {
    let h = headingMatch[1].replace(/[*_`]/g, '').trim();
    // 去掉序号前缀如 "1. " "### 1. "
    h = h.replace(/^\d+[.、]\s*/, '');
    if (h.length >= 4 && h.length <= 40) return h;
  }
  // 3. frontmatter.title
  if (frontmatter.title && frontmatter.title !== '[]' && frontmatter.title.length > 1) {
    return frontmatter.title.slice(0, 40);
  }
  // 4. 文件名
  return path.basename(fileName, '.md').replace(/^洞察[-_ ]?|^方法[-_ ]?|^概念[-_ ]?|^框架[-_ ]?|^案例[-_ ]?/, '').slice(0, 40);
}

function extractSummary(body, frontmatter) {
  // 1. 核心主张
  const claim = extractCoreClaimSentence(body);
  if (claim) return claim.slice(0, 300);
  // 2. 第一个非元描述的 blockquote
  const blockquotes = extractBlockquotes(body);
  for (const bq of blockquotes) {
    const clean = bq.replace(/\*\*/g, '').trim();
    // 跳过元描述（包含"提炼"、"总结"、"来源"等）
    if (/^(提炼|总结|来源|从.*中|以下是|这是)/.test(clean)) continue;
    if (clean.length > 10 && clean.length < 300) return clean;
  }
  // 3. 正文第一个完整句子
  const text = cleanContent(body);
  const sentences = text.split(/[。\n]/).filter(s => s.trim().length > 10 && !/^#{1,3}/.test(s.trim()));
  if (sentences.length > 0) return sentences[0].trim().slice(0, 300);
  return (frontmatter.title || '').slice(0, 80);
}

function extractScenario(body) {
  // 1. > **适用场景**：xxx
  const m1 = body.match(/>\s*\*\*适用场景\*\*\s*[：:]\s*(.+)/);
  if (m1) return m1[1].trim().replace(/\*\*/g, '').slice(0, 300);
  // 2. 模糊匹配
  const m2 = body.match(/适用场景[：:]\s*(.+)/);
  if (m2) return m2[1].trim().replace(/\*\*/g, '').slice(0, 300);
  return '';
}

function extractKeyPoints(body) {
  const points = [];
  // 提取 bullet points（- 或 * 开头的行）
  const lines = body.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+(.+)/);
    if (m) {
      let point = m[1].replace(/\*\*/g, '').replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim();
      // 跳过元描述和太短的点
      if (point.length < 5 || point.length > 80) continue;
      if (/^(核心主张|适用场景|来源|相关概念|标签|微信|精读|reader|分析|画像|验证|数据)/.test(point)) continue;
      points.push(point);
      if (points.length >= 5) break;
    }
  }
  // 如果没有 bullet points，从 ## 核心洞察 下提取
  if (points.length === 0) {
    const sectionMatch = body.match(/#{2,3}\s*核心洞察\s*\n([\s\S]*?)(?=\n#{2,3}\s|\n---|\Z)/);
    if (sectionMatch) {
      const sectionLines = sectionMatch[1].split('\n');
      for (const line of sectionLines) {
        const m = line.match(/^\s*[-*]\s+(.+)/);
        if (m) {
          let point = m[1].replace(/\*\*/g, '').trim();
          if (point.length >= 5 && point.length <= 80) {
            points.push(point);
            if (points.length >= 5) break;
          }
        }
      }
    }
  }
  return points;
}

function extractPassage(body) {
  // 结构化提取：优先取"核心洞察"章节
  const sectionMatch = body.match(/#{2,3}\s*核心洞察\s*\n([\s\S]*?)(?=\n#{2,3}\s|\n---|\Z)/);
  if (sectionMatch) {
    const section = sectionMatch[1];
    const parts = [];
    // 按 ### 子章节分割
    const subsections = section.split(/(?=^###\s)/m);
    for (const sub of subsections) {
      const headingMatch = sub.match(/^###\s+(.+)/m);
      if (headingMatch) {
        const heading = headingMatch[1].replace(/\d+[.、]\s*/, '').replace(/\*\*/g, '').trim();
        const content = sub.replace(/^###\s+.+\n?/, '').trim();
        const cleanContent = content.replace(/\*\*/g, '').replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim();
        if (heading.length > 1 && cleanContent.length > 5) {
          parts.push(`【${heading}】${cleanContent.slice(0, 200)}`);
        }
      }
    }
    if (parts.length > 0) return parts.join('\n\n').slice(0, 800);
  }
  // 回退：取第一个非标题的完整段落
  const cleaned = cleanContent(body);
  const paragraphs = cleaned.split(/\n\n+/).filter(p => {
    const t = p.trim();
    return t.length > 20 && !/^#{1,3}/.test(t) && !/^(提炼|总结|来源|从.*中)/.test(t);
  });
  if (paragraphs.length > 0) return paragraphs[0].slice(0, 500);
  return '';
}

function extractWikilinks(raw) {
  const links = [];
  const re = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    links.push(m[1].trim());
  }
  return [...new Set(links)];
}

function extractKeywords(body, frontmatter) {
  const keywords = new Set();
  if (frontmatter.tags) {
    const tags = typeof frontmatter.tags === 'string'
      ? frontmatter.tags.split(/[,，\s]+/)
      : (Array.isArray(frontmatter.tags) ? frontmatter.tags : []);
    tags.forEach(t => { if (t) keywords.add(t.replace(/^#/, '')); });
  }
  const headingRe = /^#{1,3}\s+(.+)/gm;
  let m;
  while ((m = headingRe.exec(body)) !== null) {
    const h = m[1].replace(/[*_`]/g, '').trim();
    if (h.length > 1 && h.length < 30) keywords.add(h);
  }
  return [...keywords].slice(0, 10);
}

function makeId(suit, type, fileName) {
  const hash = crypto.createHash('md5').update(fileName).digest('hex').slice(0, 8);
  const suitSlug = suit || 'unknown';
  const typeSlug = type || 'general';
  return `${suitSlug}-${typeSlug}-${hash}`;
}

function matchType(fileName, typePatterns) {
  for (const tp of typePatterns) {
    if (new RegExp(tp.regex).test(fileName)) return tp.type;
  }
  return 'general';
}

function matchSuit(relativePath, suits) {
  const normalized = relativePath.replace(/\\/g, '/');
  for (const suit of suits) {
    for (const dir of suit.directories) {
      if (normalized.startsWith(dir + '/') || normalized === dir) return suit.id;
    }
  }
  return null;
}

function matchArcana(status, arcanaMap) {
  if (!status) return 'pip';
  const s = String(status).toLowerCase().trim();
  return arcanaMap[s] || 'pip';
}

function buildCards(config) {
  const { suits, typePatterns, arcanaMap, skipDirectories, knowledgeBasePath } = config;
  const baseDir = knowledgeBasePath;
  if (!fs.existsSync(baseDir)) {
    console.error(`[ERROR] Knowledge base not found: ${baseDir}`);
    process.exit(1);
  }

  const files = walkMarkdownFiles(baseDir, skipDirectories, baseDir);
  console.log(`[INFO] Found ${files.length} markdown files`);

  const cards = [];
  const errors = [];
  const suitDistribution = {};

  for (const file of files) {
    try {
      const raw = fs.readFileSync(file.fullPath, 'utf8');
      const { frontmatter, body } = parseFrontmatter(raw);
      const cleanedBody = cleanContent(body);

      const title = extractTitle(body, frontmatter, file.fileName);
      const type = matchType(file.fileName, typePatterns);
      const suit = matchSuit(file.relativePath, suits);
      const arcana = matchArcana(frontmatter.status, arcanaMap);

      // 跳过 unknown suit 和噪声文件
      if (!suit) {
        suitDistribution['unknown'] = (suitDistribution['unknown'] || 0) + 1;
        continue;
      }

      suitDistribution[suit] = (suitDistribution[suit] || 0) + 1;

      const card = {
        id: makeId(suit, type, file.relativePath),
        title,
        sourceTitle: frontmatter.title || path.basename(file.fileName, '.md'),
        suit,
        type,
        arcana,
        summary: extractSummary(body, frontmatter),
        scenario: extractScenario(body),
        passage: extractPassage(body),
        keyPoints: extractKeyPoints(body),
        tags: extractKeywords(body, frontmatter),
        wikilinks: extractWikilinks(raw),
        filePath: file.relativePath,
        created: frontmatter.created || '',
        updated: frontmatter.updated || '',
      };
      cards.push(card);
    } catch (err) {
      errors.push({ file: file.relativePath, error: err.message });
    }
  }

  return { cards, errors, suitDistribution, totalFiles: files.length };
}

function generateReport(result) {
  const { cards, errors, suitDistribution, totalFiles } = result;
  const lines = [];
  lines.push('=== Knowledge Tarot Build Report ===');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total files scanned: ${totalFiles}`);
  lines.push(`Cards generated: ${cards.length}`);
  lines.push(`Errors: ${errors.length}`);
  lines.push('');
  lines.push('--- Suit Distribution ---');
  for (const [suit, count] of Object.entries(suitDistribution).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${suit}: ${count}`);
  }
  lines.push('');
  lines.push('--- Type Distribution ---');
  const typeDist = {};
  for (const c of cards) typeDist[c.type] = (typeDist[c.type] || 0) + 1;
  for (const [type, count] of Object.entries(typeDist).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');
  lines.push('--- Arcana Distribution ---');
  const arcanaDist = {};
  for (const c of cards) arcanaDist[c.arcana] = (arcanaDist[c.arcana] || 0) + 1;
  for (const [arcana, count] of Object.entries(arcanaDist).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${arcana}: ${count}`);
  }
  if (errors.length > 0) {
    lines.push('');
    lines.push('--- Errors ---');
    for (const e of errors) {
      lines.push(`  ${e.file}: ${e.error}`);
    }
  }
  return lines.join('\n');
}

function main() {
  console.log('[INFO] Loading config...');
  const config = loadConfig();

  console.log('[INFO] Building deck...');
  const result = buildCards(config);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const output = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    stats: {
      total: result.totalFiles,
      success: result.cards.length,
      failed: result.errors.length,
      suitDistribution: result.suitDistribution
    },
    cards: result.cards
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[INFO] Wrote ${result.cards.length} cards to ${OUTPUT_PATH}`);

  const report = generateReport(result);
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(`[INFO] Report written to ${REPORT_PATH}`);
  console.log('');
  console.log(report);
}

main();
