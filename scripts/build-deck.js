const fs = require('fs');
const path = require('path');

// ── Load config ──────────────────────────────────────────────────────
const configPath = path.resolve(__dirname, '..', 'config', 'suit-mapping.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const VAULT_PATH = config.vaultPath;
const SUITS = config.suits;
const TYPE_PATTERNS = config.typePatterns.map(p => ({
  ...p,
  regex: new RegExp(p.regex)
}));
const ARCANA_MAP = config.arcanaMap;
const SKIP_DIRS = new Set(config.skipDirectories);

// Suit code lookup: suit id → 2-letter prefix
const SUIT_CODES = {
  'sword-of-self': 'SW',
  'mirror-of-world': 'MI',
  'compass-of-method': 'CO',
  'ship-of-action': 'SH',
  'seed-of-growth': 'SE'
};

// Type → uppercase label
const TYPE_UPPER = {
  'insight': 'INSIGHT',
  'method': 'METHOD',
  'concept': 'CONCEPT',
  'framework': 'FRAMEWORK',
  'case': 'CASE'
};

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Recursively walk a directory, yielding .md file paths.
 * Skips directories in SKIP_DIRS.
 */
function walkDir(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Parse YAML frontmatter between first pair of --- lines.
 * Returns { frontmatter: object, bodyStartIndex: number } or null.
 */
function parseFrontmatter(raw) {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return null;
  const secondDash = trimmed.indexOf('\n---', 3);
  if (secondDash === -1) return null;

  const yamlBlock = trimmed.substring(3, secondDash).trim();
  const bodyStart = secondDash + 4; // skip past \n---

  const meta = {};
  let currentKey = null;
  let inArray = false;
  let arrayItems = [];

  for (const line of yamlBlock.split('\n')) {
    // Array continuation
    if (inArray && /^\s+-\s/.test(line)) {
      const val = line.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, '');
      arrayItems.push(val);
      continue;
    }
    if (inArray) {
      meta[currentKey] = arrayItems;
      inArray = false;
      arrayItems = [];
    }

    const match = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (match) {
      currentKey = match[1];
      let value = match[2].trim();
      // Inline array: [a, b, c]
      if (value.startsWith('[') && value.endsWith(']')) {
        meta[currentKey] = value
          .slice(1, -1)
          .split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else if (value === '' || value === '[]') {
        // Could be start of block array or empty
        inArray = false;
        meta[currentKey] = value === '[]' ? [] : '';
      } else {
        meta[currentKey] = value.replace(/^["']|["']$/g, '');
      }
    }
  }
  // Flush trailing array
  if (inArray && currentKey) {
    meta[currentKey] = arrayItems;
  }

  return { meta, bodyStart };
}

/**
 * Clean text: strip frontmatter, comments, wikilinks, markdown formatting.
 */
function cleanText(text) {
  let s = text;
  // Strip frontmatter
  s = s.replace(/^---[\s\S]*?---\s*/, '');
  // Strip Obsidian comments %%...%%
  s = s.replace(/%%[\s\S]*?%%/g, '');
  // Strip block-ids ^xxx
  s = s.replace(/\^[a-zA-Z0-9_-]+/g, '');
  // Convert wikilinks [[A|B]] → B, [[A]] → A
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Convert markdown links [text](url) → text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Strip bold
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  // Strip italic
  s = s.replace(/\*(.+?)\*/g, '$1');
  // Strip inline code
  s = s.replace(/`([^`]+)`/g, '$1');
  // Collapse whitespace
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

/**
 * Extract all wikilinks from raw text: [[target]] and [[target|display]].
 * Returns array of target names.
 */
function extractWikilinks(text) {
  const links = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const target = m[1].trim();
    if (target && !links.includes(target)) {
      links.push(target);
    }
  }
  return links;
}

/**
 * Find blockquote lines in text (lines starting with >).
 * Returns array of cleaned blockquote content.
 */
function extractBlockquotes(text) {
  const lines = text.split('\n');
  const quotes = [];
  for (const line of lines) {
    const m = line.match(/^>\s*(.*)/);
    if (m) {
      quotes.push(m[1].trim());
    }
  }
  return quotes;
}

/**
 * Extract content under a heading (## or ###) matching the given title.
 * Returns text until the next heading of equal or lesser depth, max maxChars.
 */
function extractSection(text, headingTitle, maxChars) {
  // Match ## 核心洞察 or ### 核心洞察
  const re = new RegExp(`^#{2,3}\\s+${headingTitle}\\s*$`, 'm');
  const match = re.exec(text);
  if (!match) return '';

  const afterHeading = text.substring(match.index + match[0].length);
  const lines = afterHeading.split('\n');
  const content = [];

  for (const line of lines) {
    // Stop at next heading of same or higher level
    if (/^#{1,3}\s+/.test(line) && !line.startsWith('####')) break;
    content.push(line);
  }

  const result = cleanText(content.join('\n'));
  return result.length > maxChars ? result.substring(0, maxChars) : result;
}

/**
 * Extract the core claim (核心主张) with multi-level fallback.
 */
function extractCoreClaim(rawBody, bodyAfterFrontmatter) {
  const quotes = extractBlockquotes(rawBody);

  // 1. Exact match: > **核心主张**：xxx or > **核心主张**: xxx
  for (const q of quotes) {
    const m = q.match(/^\*\*核心主张\*\*[：:]\s*(.+)/);
    if (m) return cleanText(m[1]);
  }

  // 2. Fuzzy match: blockquote containing 核心主张
  for (const q of quotes) {
    if (q.includes('核心主张')) {
      const cleaned = cleanText(q).replace(/核心主张[：:]?\s*/g, '');
      if (cleaned.length > 5) return cleaned;
    }
  }

  // 3. Fallback: first blockquote line in the file body
  const bodyQuotes = extractBlockquotes(bodyAfterFrontmatter);
  if (bodyQuotes.length > 0) {
    const first = cleanText(bodyQuotes[0]);
    if (first.length > 0) return first.length > 120 ? first.substring(0, 120) : first;
  }

  // 4. Final fallback: return empty string (caller will use title)
  return '';
}

/**
 * Extract scenario (适用场景).
 */
function extractScenario(rawBody) {
  const quotes = extractBlockquotes(rawBody);
  for (const q of quotes) {
    const m = q.match(/^\*\*适用场景\*\*[：:]\s*(.+)/);
    if (m) return cleanText(m[1]);
  }
  return '';
}

/**
 * Extract hook: first blockquote line in body (after frontmatter).
 */
function extractHook(bodyAfterFrontmatter) {
  const quotes = extractBlockquotes(bodyAfterFrontmatter);
  if (quotes.length > 0) {
    return cleanText(quotes[0]);
  }
  return '';
}

/**
 * Extract passage: content under ## 核心洞察 or ### 核心洞察.
 */
function extractPassage(bodyAfterFrontmatter) {
  // Try both heading levels
  let content = extractSection(bodyAfterFrontmatter, '核心洞察', 800);
  if (content.length > 50) return content;

  // Fallback: first 500 chars of cleaned body
  const cleaned = cleanText(bodyAfterFrontmatter);
  return cleaned.length > 500 ? cleaned.substring(0, 500) : cleaned;
}

/**
 * Extract keywords from title, tags, scenario.
 */
function extractKeywords(title, tags, scenario) {
  const sources = [title || '', scenario || '', ...tags];
  const text = sources.join(' ');
  // Split on non-CJK-word and non-alphanumeric boundaries
  const tokens = text
    .replace(/[，。、；：！？（）【】「」《》\[\](){}.,;:!?/\\|@#$%^&*+=~`'"<>\-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
  // Deduplicate, keep order
  const seen = new Set();
  const result = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (!seen.has(lower) && t.length >= 2) {
      seen.add(lower);
      result.push(t);
    }
  }
  return result.slice(0, 12);
}

/**
 * Map suit directory to suit object.
 * Returns the matching suit or null.
 */
function findSuit(relativePath) {
  // Normalize to forward slashes for consistent splitting
  const normalized = relativePath.replace(/\\/g, '/');
  const firstSegment = normalized.split('/')[0];
  for (const suit of SUITS) {
    if (suit.directories.includes(firstSegment)) {
      return suit;
    }
  }
  return null;
}

/**
 * Detect card type from filename.
 */
function detectType(filename) {
  for (const p of TYPE_PATTERNS) {
    if (p.regex.test(filename)) {
      return { type: p.type, label: p.label };
    }
  }
  return { type: 'other', label: '其他' };
}

/**
 * Map status to arcana.
 */
function toArcana(status) {
  if (!status) return 'pip';
  const lower = status.toLowerCase();
  return ARCANA_MAP[lower] || ARCANA_MAP[status] || 'pip';
}

/**
 * Format date from various formats to YYYY-MM-DD.
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }
  return dateStr;
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  console.log('=== 知识塔罗构建 ===');
  console.log(`Vault: ${VAULT_PATH}`);

  // 1. Walk vault
  const allFiles = walkDir(VAULT_PATH);
  console.log(`Found ${allFiles.length} markdown files`);

  // 2. Sequence counters per suit+type
  const seqCounters = {};

  // 3. Stats
  const stats = {
    total: allFiles.length,
    success: 0,
    failNoFrontmatter: 0,
    failCoreClaimFallback: 0,
    failCoreClaimTitle: 0,
    suitCounts: {},
    typeCounts: {},
    arcanaCounts: { major: 0, court: 0, pip: 0 },
    errors: []
  };

  // Init suit counts
  for (const suit of SUITS) {
    stats.suitCounts[suit.id] = 0;
  }

  const cards = [];

  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(VAULT_PATH, filePath).replace(/\\/g, '/');
      const filename = path.basename(filePath, '.md');

      // Parse frontmatter
      const parsed = parseFrontmatter(raw);
      let meta = {};
      let bodyAfterFrontmatter;

      if (parsed) {
        meta = parsed.meta;
        bodyAfterFrontmatter = raw.substring(parsed.bodyStart);
      } else {
        bodyAfterFrontmatter = raw;
        stats.failNoFrontmatter++;
      }

      // Find suit
      const suit = findSuit(relativePath);
      if (!suit) continue; // Skip files not in any suit

      // Detect type
      const typeInfo = detectType(filename);

      // Arcana
      const arcana = toArcana(meta.status);

      // Title
      const title = meta.title || filename;

      // Core claim
      let coreClaim = extractCoreClaim(raw, bodyAfterFrontmatter);
      if (!coreClaim) {
        // Use title as final fallback
        coreClaim = title;
        stats.failCoreClaimTitle++;
      }

      // Scenario
      let scenario = extractScenario(raw);

      // Hook
      let hook = extractHook(bodyAfterFrontmatter);
      if (!hook) hook = coreClaim;

      // Passage
      let passage = extractPassage(bodyAfterFrontmatter);

      // Wikilinks
      const links = extractWikilinks(raw);

      // Tags
      const tags = Array.isArray(meta.tags) ? meta.tags : [];

      // Keywords
      const keywords = extractKeywords(title, tags, scenario);

      // Dates
      const created = formatDate(meta.created || meta.date || '');
      const updated = formatDate(meta.updated || meta.date || '');

      // Source
      const source = meta.source || '';

      // Generate card ID
      const suitCode = SUIT_CODES[suit.id];
      const typeUpper = TYPE_UPPER[typeInfo.type] || 'OTHER';
      const counterKey = `${suitCode}-${typeUpper}`;
      if (!seqCounters[counterKey]) seqCounters[counterKey] = 0;
      seqCounters[counterKey]++;
      const seq = String(seqCounters[counterKey]).padStart(3, '0');
      const cardId = `${suitCode}-${typeUpper}-${seq}`;

      // Build card
      const card = {
        id: cardId,
        suit: suit.id,
        suitLabel: suit.label,
        type: typeInfo.type,
        typeLabel: typeInfo.label,
        arcana,
        title: cleanText(title),
        hook: cleanText(hook),
        summary: cleanText(coreClaim),
        scenario: cleanText(scenario),
        passage: cleanText(passage),
        filePath: relativePath,
        tags,
        status: meta.status || 'seed',
        created,
        links,
        keywords
      };

      // If source exists, add it
      if (source) card.source = source;

      cards.push(card);
      stats.success++;

      // Update counters
      stats.suitCounts[suit.id]++;
      if (typeInfo.type !== 'other') {
        stats.typeCounts[typeInfo.type] = (stats.typeCounts[typeInfo.type] || 0) + 1;
      }
      stats.arcanaCounts[arcana] = (stats.arcanaCounts[arcana] || 0) + 1;

    } catch (err) {
      stats.errors.push({ file: filePath, error: err.message });
    }
  }

  // 4. Build output
  const suitsMeta = {};
  for (const suit of SUITS) {
    suitsMeta[suit.id] = {
      count: stats.suitCounts[suit.id],
      label: suit.label,
      icon: suit.icon,
      theme: suit.theme
    };
  }

  const output = {
    meta: {
      vaultPath: VAULT_PATH.replace(/\\/g, '/'),
      buildDate: new Date().toISOString().substring(0, 10),
      totalCards: cards.length,
      suits: suitsMeta
    },
    cards
  };

  // 5. Write output
  const outDir = path.resolve(__dirname, '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'cards.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  // 6. Print validation report
  const failTotal = stats.failNoFrontmatter + stats.failCoreClaimFallback + stats.failCoreClaimTitle;
  console.log('');
  console.log('=== 知识塔罗构建报告 ===');
  console.log(`总文件: ${stats.total}`);
  console.log(`成功提取: ${stats.success} (${(stats.success / stats.total * 100).toFixed(1)}%)`);
  console.log(`失败: ${failTotal}`);
  console.log(`  - 无 frontmatter: ${stats.failNoFrontmatter}`);
  console.log(`  - 核心主张回退到 title: ${stats.failCoreClaimTitle}`);

  // Suit distribution
  const suitLabels = SUITS.map(s => `${s.label}(${stats.suitCounts[s.id]})`).join('  ');
  console.log(`花色分布: ${suitLabels}`);

  // Type distribution
  const typeOrder = ['insight', 'method', 'concept', 'framework', 'case'];
  const typeLabels = typeOrder
    .filter(t => stats.typeCounts[t])
    .map(t => {
      const label = TYPE_PATTERNS.find(p => p.type === t)?.label || t;
      return `${label}(${stats.typeCounts[t] || 0})`;
    })
    .join('  ');
  console.log(`牌型分布: ${typeLabels}`);

  // Arcana distribution
  console.log(`牌位分布: 大阿尔卡纳(${stats.arcanaCounts.major})  宫廷牌(${stats.arcanaCounts.court})  数字牌(${stats.arcanaCounts.pip})`);

  // Errors
  if (stats.errors.length > 0) {
    console.log(`\n解析错误: ${stats.errors.length}`);
    for (const e of stats.errors.slice(0, 10)) {
      console.log(`  - ${e.file}: ${e.error}`);
    }
    if (stats.errors.length > 10) {
      console.log(`  ... 还有 ${stats.errors.length - 10} 个错误`);
    }
  }

  console.log(`\n输出: ${outPath}`);
  console.log('构建完成。');
}

main();
