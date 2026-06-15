/**
 * v2-app.js — 抽牌主页（极简黑白风）
 * 导入功能已移到 v2-import.html，本页只做抽牌 + 解读 + 深度对话
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let state = { user: null, deckSize: 0, currentSpread: 'single', currentCards: [] };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    await refreshMe();
    bindEvents();

    if (state.deckSize === 0) {
      $('emptyState').classList.remove('hidden');
    } else {
      $('drawSection').classList.remove('hidden');
    }
  }

  async function refreshMe() {
    try {
      const r = await fetch('/api/v2/me');
      const data = await r.json();
      state.user = data.user;
      state.deckSize = data.deckSize || 0;
      $('deckBadge').textContent = state.deckSize > 0 ? `${state.deckSize} 张牌` : '';
      $('styleSelect').value = data.user.style || 'gentle';
    } catch (e) { console.error(e); }
  }

  function bindEvents() {
    // 风格切换
    $('styleSelect').addEventListener('change', async (e) => {
      await fetch('/api/v2/me/style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: e.target.value })
      });
    });

    // 牌阵选择
    document.querySelectorAll('.spread-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.spread-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentSpread = btn.dataset.spread;
      });
    });

    // 字数计数
    $('questionInput').addEventListener('input', e => {
      $('charCount').textContent = e.target.value.length + '/200';
    });
    $('questionInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleDraw();
    });

    // 抽牌
    $('drawBtn').addEventListener('click', handleDraw);
    $('redrawBtn').addEventListener('click', handleDraw);

    // 深度对话
    $('dialogueOverlay').addEventListener('click', closeDialogue);
    $('dialogueClose').addEventListener('click', closeDialogue);
    $('dialogueSend').addEventListener('click', sendDialogue);
    $('dialogueInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendDialogue();
    });
  }

  // ── 抽牌 ────────────────────────────────────────────
  async function handleDraw() {
    const question = $('questionInput').value.trim();
    const spread = state.currentSpread;

    $('cardsArea').classList.remove('hidden');
    $('cardsContainer').innerHTML = '';
    $('aiSection').classList.remove('hidden');
    $('aiContent').innerHTML = '';
    $('aiLoading').classList.remove('hidden');

    try {
      const r = await fetch(`/api/v2/draw/${spread}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '抽牌失败');

      const cards = spread === 'single' ? [data.card] : data.cards;
      state.currentCards = cards;

      // 渲染卡片，先盖牌再翻
      renderCards(cards);

      // 等待翻牌动画
      await sleep(cards.length * 300 + 600);

      // 渲染解读
      $('aiLoading').classList.add('hidden');
      if (spread === 'single') renderSingleAI(data);
      else renderThreeAI(data);

      // 滚动到卡片区
      $('cardsArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      $('aiLoading').classList.add('hidden');
      $('aiContent').innerHTML = `<div class="text-red-600">✗ ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderCards(cards) {
    const container = $('cardsContainer');
    container.innerHTML = '';
    cards.forEach((card, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'card-wrapper';
      wrapper.dataset.cardId = card.id;
      wrapper.innerHTML = `
        <div class="card-inner">
          <div class="card-face card-back">
            <svg class="card-back-pattern" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="0.8" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
            </svg>
          </div>
          <div class="card-face card-front suit-${escapeAttr(card.suit)}">
            ${card.positionName ? `<div class="position-label">${escapeHtml(card.positionName)}</div>` : ''}
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs text-tarot-muted">${escapeHtml(card.suitName || '')}</span>
              <span class="text-xs text-tarot-muted">${contentTypeLabel(card.contentType)}</span>
            </div>
            <h3 class="font-serif font-bold text-xl text-black mb-3 leading-snug">${escapeHtml(card.title)}</h3>
            <div class="flex-1 overflow-hidden text-sm text-tarot-ivory leading-relaxed">
              ${renderCardBody(card)}
            </div>
            <button class="mt-3 w-full py-2 rounded-lg border border-tarot-border text-xs text-tarot-muted hover:text-black hover:border-black/40 transition-colors detail-btn">
              深度对话
            </button>
          </div>
        </div>
      `;
      container.appendChild(wrapper);

      // 点击翻牌（首次自动翻）
      setTimeout(() => wrapper.classList.add('flipped'), 200 + idx * 300);

      // 深度对话按钮
      wrapper.querySelector('.detail-btn').addEventListener('click', e => {
        e.stopPropagation();
        openDialogue(card);
      });
    });
  }

  function contentTypeLabel(t) {
    return ({ reflection: '反思', opinion: '观点', analysis: '洞察' })[t] || '';
  }

  function renderCardBody(card) {
    if (card.contentType === 'analysis') {
      const summary = card.summary
        ? `<p class="font-medium mb-2">${escapeHtml(card.summary)}</p>`
        : '';
      const list = (card.insights || []).map(s =>
        `<div class="text-xs text-tarot-muted mb-1.5 pl-2 border-l-2 border-tarot-border">${escapeHtml(s)}</div>`
      ).join('');
      return summary + list;
    }
    if (card.contentType === 'opinion' && card.summary) {
      return `<p class="font-medium mb-2">${escapeHtml(card.summary)}</p>
              <p class="text-xs text-tarot-muted leading-relaxed">${escapeHtml((card.passage || '').slice(0, 150))}${(card.passage || '').length > 150 ? '…' : ''}</p>`;
    }
    return `<p class="leading-relaxed">${escapeHtml((card.passage || '').slice(0, 220))}${(card.passage || '').length > 220 ? '…' : ''}</p>`;
  }

  // ── AI 解读渲染 ─────────────────────────────────────
  function renderSingleAI(data) {
    const html = `
      <div class="space-y-3">
        ${(data.questions || []).map(q =>
          `<p class="text-tarot-ivory italic leading-relaxed border-l-2 border-black pl-4">${escapeHtml(q)}</p>`
        ).join('')}
      </div>
    `;
    $('aiContent').innerHTML = html;
  }

  function renderThreeAI(data) {
    const narr = data.narrative || {};
    const html = `
      ${narr.narrative ? `
        <div>
          <div class="text-xs text-tarot-muted uppercase tracking-wider mb-2">叙事</div>
          <p class="text-tarot-ivory leading-relaxed">${escapeHtml(narr.narrative)}</p>
        </div>
      ` : ''}
      ${narr.question ? `
        <div class="pt-3 border-t border-tarot-border">
          <div class="text-xs text-tarot-muted uppercase tracking-wider mb-2">向内问</div>
          <p class="text-tarot-ivory italic leading-relaxed border-l-2 border-black pl-4">${escapeHtml(narr.question)}</p>
        </div>
      ` : ''}
    `;
    $('aiContent').innerHTML = html || '<p class="text-tarot-muted text-sm">解读为空</p>';
  }

  // ── 深度对话 ─────────────────────────────────────────
  let dialogueState = { card: null, transcript: [] };

  async function openDialogue(card) {
    dialogueState = { card, transcript: [] };
    $('dialogueCardSuit').textContent = `${card.suitName || ''} · ${card.positionName || '日签'}`;
    $('dialogueCardTitle').textContent = card.title;
    $('dialogueScroll').innerHTML = `<div class="text-tarot-muted text-xs italic text-center py-2">围绕这张牌的对话开始。AI 只问问题，不会给你答案。</div>`;
    $('dialogueModal').classList.remove('hidden');
    $('dialogueInput').value = '';
    setTimeout(() => $('dialogueScroll').scrollTop = 0, 50);
    await aiAsk();
  }

  function closeDialogue() {
    $('dialogueModal').classList.add('hidden');
  }

  async function aiAsk() {
    appendDialogue('ai', '...', true);
    try {
      const r = await fetch('/api/v2/dialogue/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: dialogueState.card.id, transcript: dialogueState.transcript })
      });
      const data = await r.json();
      removeLoading();
      if (!r.ok) throw new Error(data.error || '对话失败');
      const q = data.question || '...';
      dialogueState.transcript.push({ role: 'ai', text: q });
      appendDialogue('ai', q);
    } catch {
      removeLoading();
      appendDialogue('ai', '（AI 暂时没接上）');
    }
  }

  function sendDialogue() {
    const text = $('dialogueInput').value.trim();
    if (!text) return;
    dialogueState.transcript.push({ role: 'user', text });
    appendDialogue('user', text);
    $('dialogueInput').value = '';
    aiAsk();
  }

  function appendDialogue(role, text, loading) {
    const scroll = $('dialogueScroll');
    const isAi = role === 'ai';
    const node = document.createElement('div');
    node.className = `flex ${isAi ? 'justify-start' : 'justify-end'}`;
    if (loading) node.dataset.loading = '1';
    node.innerHTML = `
      <div class="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
        ${isAi ? 'bg-tarot-accent text-tarot-ivory' : 'bg-black text-white'}">
        ${loading ? '<span class="opacity-50">…</span>' : escapeHtml(text)}
      </div>
    `;
    scroll.appendChild(node);
    scroll.scrollTop = scroll.scrollHeight;
  }

  function removeLoading() {
    const el = $('dialogueScroll').querySelector('[data-loading]');
    if (el) el.remove();
  }

  // ── utils ───────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_-]/g, '');
  }

})();
