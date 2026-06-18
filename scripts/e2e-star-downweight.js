// scripts/e2e-star-downweight.js — verify ⭐ cards are drawn ~half as often as un-starred
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3457;
const COOKIE_FILE = path.join(__dirname, '..', 'test-cookie.txt');
let cookie = '';
const txt = fs.readFileSync(COOKIE_FILE, 'utf-8');
for (const line of txt.split(/\r?\n/)) {
  const clean = line.replace(/^#HttpOnly_/, '');
  if (clean.startsWith('#') || !clean.trim()) continue;
  const parts = clean.split('\t');
  if (parts.length >= 7 && parts[5] === 'kt_uid') cookie = `kt_uid=${parts[6]}`;
}

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: 'localhost', port: PORT, path: p, method,
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json',
                 ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, (res) => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
                            catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on('error', reject);
    if (data) r.write(data); r.end();
  });
}

(async () => {
  // Get active deck
  const me = await req('GET', '/api/v2/me');
  const deckId = me.body?.user?.activeDeckId;
  console.log('deckId =', deckId);

  // Clear all feedback
  await req('POST', '/api/v2/feedback', { deckId, cardId: 'card-old01', kind: 'clear' });
  await req('POST', '/api/v2/feedback', { deckId, cardId: 'card-old02', kind: 'clear' });
  await req('POST', '/api/v2/feedback', { deckId, cardId: 'card-new01', kind: 'clear' });

  // Star card-old01
  await req('POST', '/api/v2/feedback', { deckId, cardId: 'card-old01', kind: 'star' });
  await req('POST', '/api/v2/history/clear', {});  // not sure about endpoint, ignore failure
  await req('DELETE', '/api/v2/history', {});

  // Draw 100 times with empty question (small_deck mode → uses pickWeighted with starred downweight)
  const counts = {};
  for (let i = 0; i < 100; i++) {
    const r = await req('POST', '/api/v2/draw/single', { question: '' });
    const id = r.body?.card?.id;
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  console.log('draw counts over 100 trials:', counts);

  // card-old01 has STAR_DOWNWEIGHT 0.5; card-old02 is also 90+ days so 2x; card-new01 is 7 days (no aging bonus)
  // Effective weights:
  //   card-old01: 1.0 * 2.0 (90+) * 0.5 (star) = 1.0
  //   card-old02: 1.0 * 2.0 (90+)             = 2.0
  //   card-new01: 1.0                         = 1.0
  // Expected: old02 ~ 50% (2/4), old01 ~ 25% (1/4), new01 ~ 25% (1/4)
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const ratio = (id) => ((counts[id] || 0) / total * 100).toFixed(1);
  console.log(`old01 (starred + 90+ days) = ${ratio('card-old01')}% — expect ~25%`);
  console.log(`old02 (90+ days)           = ${ratio('card-old02')}% — expect ~50%`);
  console.log(`new01 (7 days)             = ${ratio('card-new01')}% — expect ~25%`);
  console.log();

  const old01Pct = (counts['card-old01'] || 0) / total;
  const old02Pct = (counts['card-old02'] || 0) / total;
  const ok = old02Pct > old01Pct * 1.3;  // old02 should be drawn substantially more than starred old01
  console.log(ok ? '✓ ⭐ downweight working: starred card drawn less than equivalent un-starred old card'
                  : `✗ FAIL: old01=${old01Pct.toFixed(2)} vs old02=${old02Pct.toFixed(2)}`);
  process.exit(ok ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
