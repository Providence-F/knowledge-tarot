/**
 * v2-app.js — 抽牌主页（极简黑白风）
 * 改动：
 *  - 去掉每张牌上的"深度对话"按钮，改为整张牌点击 → 卡片详情 modal
 *  - AI 解读区下方增加一个全局"深度对话"按钮：单牌用该牌，三牌阵把三张当整体
 *  - 深度对话首问会带上用户最初的问题（无问题则走保底池）
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let state = {
    user: null,
    deckSize: 0,
    currentSpread: 'single',
    currentCards: [],
    currentQuestion: '',
    publicDeck: { available: false }
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    await refreshMe();
    bindEvents();
    bindOnboarding();

    // 决定首屏：先看是否需要引导
    const mode = state.user?.mode;
    if (!mode) {
      // 没选过：弹引导墙
      showOnboarding();
    } else if (mode === 'public') {
      $('modeBanner').classList.remove('hidden');
      $('drawSection').classList.remove('hidden');
    } else {
      // private：按是否有牌决定
      if (state.deckSize === 0) {
        $('emptyState').classList.remove('hidden');
      } else {
        $('drawSection').classList.remove('hidden');
      }
    }
  }

  async function refreshMe() {
    try {
      const r = await fetch('/api/v2/me');
      const data = await r.json();
      state.user = data.user;
      state.deckSize = data.deckSize || 0;
      state.publicDeck = data.publicDeck || { available: false };
      const badgeText = state.user?.mode === 'public'
        ? `${state.publicDeck.totalCards || 0} 张 · DEMO`
        : (state.deckSize > 0 ? `${state.deckSize} 张牌` : '');
      $('deckBadge').textContent = badgeText;
      const dbm = $('deckBadgeMobile'); if (dbm) dbm.textContent = badgeText;
      const styleVal = data.user?.style || 'gentle';
      $('styleSelect').value = styleVal;
      const sm = $('styleSelectMobile'); if (sm) sm.value = styleVal;
      if (data.userIdShort) {
        const badge = $('userIdBadge');
        badge.textContent = data.userIdShort;
        badge.classList.remove('hidden');
        const mb = $('userIdBadgeMobile');
        const wrap = $('userIdBadgeMobileWrap');
        if (mb && wrap) {
          mb.textContent = data.userIdShort;
          wrap.classList.remove('hidden');
          wrap.classList.add('flex');
        }
      }
      // 公共牌堆描述
      if (state.publicDeck.available) {
        const sizeEl = $('onbPublicSize');
        if (sizeEl) sizeEl.textContent = `📚 ${state.publicDeck.totalCards} 张 · ${state.publicDeck.sourceLabel || ''}`;
        const banner = $('modeBannerName');
        if (banner && state.publicDeck.name) banner.textContent = state.publicDeck.name;
      } else {
        const sizeEl = $('onbPublicSize');
        if (sizeEl) sizeEl.textContent = '⚠ 公共牌堆暂未就绪';
        const onbPub = $('onbPublic');
        if (onbPub) {
          onbPub.disabled = true;
          onbPub.classList.add('opacity-50', 'cursor-not-allowed');
        }
      }
    } catch (e) { console.error(e); }
  }

  function bindEvents() {
    $('styleSelect').addEventListener('change', async (e) => {
      const v = e.target.value;
      const sm = $('styleSelectMobile'); if (sm) sm.value = v;
      await fetch('/api/v2/me/style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: v })
      });
    });
    const styleSelectMobile = $('styleSelectMobile');
    if (styleSelectMobile) {
      styleSelectMobile.addEventListener('change', async (e) => {
        const v = e.target.value;
        $('styleSelect').value = v;
        await fetch('/api/v2/me/style', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ style: v })
        });
      });
    }

    // 汉堡菜单切换
    const navToggle = $('navToggle');
    const navMenu = $('navMenu');
    if (navToggle && navMenu) {
      navToggle.addEventListener('click', () => navMenu.classList.toggle('hidden'));
    }

    document.querySelectorAll('.spread-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.spread-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentSpread = btn.dataset.spread;
      });
    });

    $('questionInput').addEventListener('input', e => {
      $('charCount').textContent = e.target.value.length + '/200';
    });
    $('questionInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleDraw();
    });

    $('drawBtn').addEventListener('click', handleDraw);
    $('redrawBtn').addEventListener('click', handleDraw);

    // 全局深度对话
    $('openDialogueBtn').addEventListener('click', openGlobalDialogue);

    // 卡片详情 modal
    $('cardDetailOverlay').addEventListener('click', closeCardDetail);
    $('cardDetailClose').addEventListener('click', closeCardDetail);

    // 深度对话 modal
    $('dialogueOverlay').addEventListener('click', closeDialogue);
    $('dialogueClose').addEventListener('click', closeDialogue);
    $('dialogueSend').addEventListener('click', sendDialogue);
    $('dialogueInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendDialogue();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('cardDetailModal').classList.contains('hidden')) closeCardDetail();
      else if (!$('dialogueModal').classList.contains('hidden')) closeDialogue();
    });
  }

  // ── Onboarding ───────────────────────────────────────────
  function showOnboarding() {
    $('onboardingModal').classList.remove('hidden');
  }

  function closeOnboarding() {
    $('onboardingModal').classList.add('hidden');
  }

  function bindOnboarding() {
    $('onbPrivate').addEventListener('click', async () => {
      try {
        const r = await fetch('/api/v2/me/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'private' })
        });
        if (!r.ok) throw new Error('设置失败');
        closeOnboarding();
        // 引导去导入页
        window.location.href = 'v2-import.html';
      } catch (e) {
        alert('设置失败，请刷新重试');
      }
    });

    $('onbPublic').addEventListener('click', async () => {
      try {
        const r = await fetch('/api/v2/me/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'public' })
        });
        if (!r.ok) throw new Error('设置失败');
        closeOnboarding();
        location.reload();
      } catch (e) {
        alert('设置失败，请刷新重试');
      }
    });

    // 隐私说明 modal
    $('privacyLink').addEventListener('click', (e) => {
      e.preventDefault();
      $('privacyModal').classList.remove('hidden');
    });
    $('privacyOverlay').addEventListener('click', () => $('privacyModal').classList.add('hidden'));
    $('privacyClose').addEventListener('click', () => $('privacyModal').classList.add('hidden'));

    // 公共模式下，"导入我自己的内容"的引导按钮
    const switchBtn = $('switchToPrivate');
    if (switchBtn) {
      switchBtn.addEventListener('click', async () => {
        try {
          const r = await fetch('/api/v2/me/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'private' })
          });
          if (!r.ok) throw new Error('设置失败');
          window.location.href = 'v2-import.html';
        } catch { alert('切换失败，请刷新重试'); }
      });
    }
  }

  // ── 抽牌 ────────────────────────────────────────────
  async function handleDraw() {
    const question = $('questionInput').value.trim();
    const spread = state.currentSpread;
    state.currentQuestion = question;

    $('cardsArea').classList.remove('hidden');
    $('cardsContainer').innerHTML = '';
    $('aiSection').classList.remove('hidden');
    $('aiContent').innerHTML = '';
    $('aiLoading').classList.remove('hidden');
    $('openDialogueBtn').classList.add('hidden');

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

      renderCards(cards);
      await sleep(cards.length * 300 + 600);

      $('aiLoading').classList.add('hidden');
      if (spread === 'single') renderSingleAI(data);
      else renderThreeAI(data);

      $('openDialogueBtn').classList.remove('hidden');
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
      wrapper.className = 'card-wrapper cursor-pointer';
      wrapper.dataset.cardId = card.id;
      wrapper.title = '点击查看完整内容';
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
            <div class="mt-3 pt-2 text-[11px] text-tarot-muted text-center border-t border-tarot-border">
              点击查看完整内容
            </div>
          </div>
        </div>
      `;
      container.appendChild(wrapper);

      setTimeout(() => wrapper.classList.add('flipped'), 200 + idx * 300);

      wrapper.addEventListener('click', () => {
        if (!wrapper.classList.contains('flipped')) return;
        openCardDetail(card);
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

  // ── 卡片详情 modal ────────────────────────────────────
  async function openCardDetail(card) {
    $('cardDetailMeta').textContent = [
      card.suitName || '',
      card.positionName || '',
      contentTypeLabel(card.contentType)
    ].filter(Boolean).join(' · ');
    $('cardDetailTitle').textContent = card.title || '—';
    $('cardDetailBody').innerHTML = renderCardDetailBody(card);
    $('cardDetailCount').textContent = formatCount(card);
    $('cardDetailModal').classList.remove('hidden');
    setTimeout(() => $('cardDetailBody').scrollTop = 0, 30);

    // 旧数据没有 fullPassage 时，向后端拉一次完整 card
    if (!card.fullPassage && card.id) {
      const loading = $('cardDetailLoading');
      loading.classList.remove('hidden');
      try {
        const r = await fetch(`/api/v2/deck/card/${encodeURIComponent(card.id)}`);
        if (r.ok) {
          const full = await r.json();
          // 合并到当前抽出的 card 引用，避免重复请求
          Object.assign(card, {
            fullPassage: full.fullPassage || full.passage || '',
            passage: card.passage || full.passage || '',
            summary: card.summary || full.summary || '',
            insights: card.insights || full.insights || null,
            source: card.source || full.source || null
          });
          $('cardDetailBody').innerHTML = renderCardDetailBody(card);
          $('cardDetailCount').textContent = formatCount(card);
        }
      } catch {}
      loading.classList.add('hidden');
    }
  }

  function closeCardDetail() {
    $('cardDetailModal').classList.add('hidden');
  }

  function renderCardDetailBody(card) {
    const parts = [];
    const fullText = card.fullPassage || card.passage || '';

    if (card.summary) {
      parts.push(`<span class="section-label">核心</span>`);
      parts.push(`<p class="lead">${escapeHtml(card.summary)}</p>`);
    }

    if (card.contentType === 'analysis' && Array.isArray(card.insights) && card.insights.length) {
      parts.push(`<span class="section-label">洞察</span>`);
      parts.push(card.insights.map(s =>
        `<div class="insight-card">${escapeHtml(s)}</div>`
      ).join(''));
    }

    if (fullText && fullText.trim()) {
      parts.push(`<span class="section-label">${card.contentType === 'analysis' ? '原文' : '正文'}</span>`);
      parts.push(`<div class="passage-block">${formatPassage(fullText)}</div>`);
    } else if (parts.length === 0) {
      parts.push(`<p class="text-tarot-muted">这张牌还没有正文内容</p>`);
    }

    if (card.source && (card.source.label || card.source.path)) {
      const src = card.source.label || card.source.path;
      parts.push(`<div class="source-line">来源：<code>${escapeHtml(src)}</code></div>`);
    }

    return parts.join('');
  }

  function formatPassage(text) {
    // 把连续两个换行变成段落，单换行保留
    const paragraphs = String(text).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return '';
    return paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  }

  function formatCount(card) {
    const text = card.fullPassage || card.passage || '';
    const len = text.length;
    if (!len) return '';
    return `${len.toLocaleString()} 字`;
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

  // ── 深度对话（全局，针对当前抽出的所有牌） ──────────
  let dialogueState = { cards: [], dialogueId: null, transcript: [], userQuestion: '' };

  function openGlobalDialogue() {
    const cards = state.currentCards || [];
    if (cards.length === 0) return;
    dialogueState = {
      cards,
      dialogueId: null,
      transcript: [],
      userQuestion: state.currentQuestion || ''
    };

    const titleText = cards.length === 1
      ? cards[0].title
      : cards.map(c => c.title).join(' · ');
    const metaText = cards.length === 1
      ? `${cards[0].suitName || ''} · ${cards[0].positionName || '日签'}`
      : `三牌阵 · 整体对话`;

    $('dialogueCardSuit').textContent = metaText;
    $('dialogueCardTitle').textContent = titleText;

    const opener = state.currentQuestion
      ? `围绕"${state.currentQuestion}"展开。AI 只问问题，不会给你答案。`
      : '围绕这副牌的对话开始。AI 只问问题，不会给你答案。';
    $('dialogueScroll').innerHTML = `<div class="text-tarot-muted text-xs italic text-center py-2">${escapeHtml(opener)}</div>`;
    $('dialogueModal').classList.remove('hidden');
    $('dialogueInput').value = '';
    setTimeout(() => $('dialogueScroll').scrollTop = 0, 50);
    aiAsk();
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
        body: JSON.stringify({
          cardIds: dialogueState.cards.map(c => c.id),
          dialogueId: dialogueState.dialogueId,
          transcript: dialogueState.transcript,
          userQuestion: dialogueState.userQuestion
        })
      });
      const data = await r.json();
      removeLoading();
      if (!r.ok) throw new Error(data.error || '对话失败');
      const q = data.question || '...';
      if (data.dialogueId) dialogueState.dialogueId = data.dialogueId;
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
