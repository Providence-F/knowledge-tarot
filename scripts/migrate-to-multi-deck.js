/**
 * scripts/migrate-to-multi-deck.js — v1.0 → v1.1 数据迁移
 *
 * 把 data/users/{uid}/deck.json 拆分到 data/users/{uid}/decks/{deckId}.json
 * 幂等：如果 decks/ 目录已经有 *.json 就跳过该用户。
 *
 * 用法:
 *   node scripts/migrate-to-multi-deck.js              # dry-run，只打印计划
 *   node scripts/migrate-to-multi-deck.js --apply      # 实际执行
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_BASE = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : path.join(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA_BASE, 'users');

const APPLY = process.argv.includes('--apply');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function newDeckId() {
  return crypto.randomBytes(6).toString('hex');
}

function migrateUser(userId) {
  const userDir = path.join(USERS_DIR, userId);
  const profilePath = path.join(userDir, 'profile.json');
  const legacyDeckPath = path.join(userDir, 'deck.json');
  const decksDir = path.join(userDir, 'decks');
  const historyPath = path.join(userDir, 'history.json');
  const dialoguesDir = path.join(userDir, 'dialogues');

  const result = {
    userId,
    actions: [],
    skipped: false,
    deckId: null
  };

  // 幂等检查
  if (fs.existsSync(decksDir)) {
    const existing = fs.readdirSync(decksDir).filter(f => f.endsWith('.json'));
    if (existing.length > 0) {
      result.skipped = true;
      result.actions.push(`already migrated (${existing.length} decks)`);
      return result;
    }
  }

  const profile = readJSON(profilePath, null) || {
    id: userId,
    createdAt: Date.now(),
    style: 'gentle'
  };

  const legacyDeck = readJSON(legacyDeckPath, null);
  let newDeckIdValue = null;

  if (legacyDeck && Array.isArray(legacyDeck.cards) && legacyDeck.cards.length > 0) {
    newDeckIdValue = newDeckId();
    const now = Date.now();
    const newDeck = {
      id: newDeckIdValue,
      ownerId: userId,
      name: '我的牌堆',
      description: '从 v1.0 迁移',
      emoji: '📚',
      visibility: 'private',
      createdAt: legacyDeck.meta?.createdAt || now,
      updatedAt: now,
      totalCards: legacyDeck.cards.length,
      lastImport: legacyDeck.meta || null,
      cards: legacyDeck.cards
    };
    const newDeckPath = path.join(decksDir, `${newDeckIdValue}.json`);
    if (APPLY) {
      writeJSON(newDeckPath, newDeck);
      // 备份旧 deck.json
      fs.renameSync(legacyDeckPath, legacyDeckPath + '.bak');
    }
    result.actions.push(`split deck.json → decks/${newDeckIdValue}.json (${legacyDeck.cards.length} cards), backup deck.json.bak`);
  } else if (legacyDeck) {
    // 空 deck，直接备份不创建新 deck 文件
    if (APPLY) {
      fs.renameSync(legacyDeckPath, legacyDeckPath + '.bak');
    }
    result.actions.push('legacy deck.json was empty → backup .bak only');
  }

  // 更新 profile
  const newProfile = { ...profile };
  if (!Array.isArray(newProfile.ownedDeckIds)) newProfile.ownedDeckIds = [];
  if (newProfile.activeDeckId === undefined) newProfile.activeDeckId = null;
  if (newProfile.onboardedAt === undefined) newProfile.onboardedAt = null;

  if (newDeckIdValue) {
    if (!newProfile.ownedDeckIds.includes(newDeckIdValue)) {
      newProfile.ownedDeckIds.push(newDeckIdValue);
    }
    if (!newProfile.activeDeckId) newProfile.activeDeckId = newDeckIdValue;
    result.actions.push(`profile.activeDeckId = ${newDeckIdValue}`);
  } else if (newProfile.mode === 'public' && !newProfile.activeDeckId) {
    newProfile.activeDeckId = 'system-default';
    result.actions.push(`profile.activeDeckId = system-default (was mode=public)`);
  }

  if (APPLY) writeJSON(profilePath, newProfile);

  // history.json：每条 entry 加 deckId
  if (fs.existsSync(historyPath)) {
    const history = readJSON(historyPath, []);
    let touched = 0;
    const tagged = history.map(h => {
      if (h.deckId) return h;
      touched += 1;
      return { ...h, deckId: newDeckIdValue || 'system-default' };
    });
    if (touched > 0) {
      if (APPLY) writeJSON(historyPath, tagged);
      result.actions.push(`tagged ${touched} history entries with deckId`);
    }
  }

  // dialogues/*.json：每个 dialogue 加 deckId
  if (fs.existsSync(dialoguesDir)) {
    const files = fs.readdirSync(dialoguesDir).filter(f => f.endsWith('.json'));
    let touched = 0;
    for (const f of files) {
      const fp = path.join(dialoguesDir, f);
      const d = readJSON(fp, null);
      if (!d || d.deckId) continue;
      d.deckId = newDeckIdValue || 'system-default';
      if (APPLY) writeJSON(fp, d);
      touched += 1;
    }
    if (touched > 0) {
      result.actions.push(`tagged ${touched} dialogue files with deckId`);
    }
  }

  result.deckId = newDeckIdValue;
  return result;
}

function main() {
  if (!fs.existsSync(USERS_DIR)) {
    console.error(`No users dir: ${USERS_DIR}`);
    process.exit(1);
  }
  const users = fs.readdirSync(USERS_DIR).filter(name => {
    const stat = fs.statSync(path.join(USERS_DIR, name));
    return stat.isDirectory();
  });

  console.log(`[migrate-to-multi-deck] mode=${APPLY ? 'APPLY' : 'dry-run'}, users=${users.length}`);
  let migrated = 0, skipped = 0;
  for (const u of users) {
    try {
      const r = migrateUser(u);
      if (r.skipped) {
        skipped += 1;
        console.log(`  ~ ${u}: SKIP (${r.actions.join('; ')})`);
      } else {
        migrated += 1;
        console.log(`  ✓ ${u}: ${r.actions.length ? r.actions.join('; ') : '(no-op)'}`);
      }
    } catch (e) {
      console.error(`  ✗ ${u}: ${e.message}`);
    }
  }
  console.log(`\nDone. migrated=${migrated}, skipped=${skipped}`);
  if (!APPLY) console.log('(dry-run; pass --apply to commit)');
}

if (require.main === module) main();

module.exports = { migrateUser };
