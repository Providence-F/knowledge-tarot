/**
 * v2-library.js — 我的牌库（牌堆/抽牌历史/对话历史/身份）
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let state = { deck: [], history: [], dialogues: [], userId: '', filter: 'all', sort: 'newest' };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    await Promise.all([loadDeck(), loadHistory(), loadDialogues(), loadAccount()]);
    switchTab('deck');
  }

  function bindEvents() {
    document.querySelectorAll('.lib-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    $('clearDeckBtn').addEventListener('click', async () => {
      if (!confirm('确认清空整副牌堆？此操作不可恢复（你的导入源文件不受影响）。')) return;
      const r = await fetch('/api/v2/deck', { method: 'DELETE' });
      if (r.ok) { state.deck = []; renderDeckStats(); renderDeck(); refreshBadges(); }
    });

    $('clearHistoryBtn').addEventListener('click', async () => {
      if (!confirm('确认清空抽牌历史？')) return;
      const r = await fetch('/api/v2/history', { method: 'DELETE' });
      if (r.ok) { state.history = []; renderHistory(); refreshBadges(); }
    });

    $('deckSearch').addEventListener('input', renderDeck);
    $('deckSort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderDeck();
    });
    document.querySelectorAll('#typeFilter .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#typeFilter .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.filter = chip.dataset.filter;
        renderDeck();
      });
    });

    // card detail modal
    $('cardModalOverlay').addEventListener('click', closeCardModal);
    $('cardModalClose').addEventListener('click', closeCardModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('cardModal').classList.contains('hidden')) closeCardModal();
    });

    $('copyIdBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(state.userId);
        $('copyIdBtn').textContent = '已复制 ✓';
        setTimeout(() => $('copyIdBtn').textContent = '复制', 2000);
      } catch {
        $('myUserId').select();
        document.execCommand('copy');
      }
    });

    $('restoreBtn').addEventListener('click', handleRestore);

    // share current deck
    const shareBtn = $('shareDeckBtn');
    if (shareBtn) shareBtn.addEventListener('click', handleShare);
    $('libShareClose')?.addEventListener('click', () => $('libShareModal').classList.add('hidden'));
    $('libShareOverlay')?.addEventListener('click', () => $('libShareModal').classList.add('hidden'));
    $('libShareCopy')?.addEventListener('click', async () => {
      const url = $('libShareUrl').value;
      try { await navigator.clipboard.writeText(url); }
      catch { $('libShareUrl').select(); document.execCommand('copy'); }
      const hint = $('libShareHint');
      hint.classList.remove('hidden');
      setTimeout(() => hint.classList.add('hidden'), 2000);
    });
  }

  async function handleShare() {
    try {
      const meRes = await fetch('/api/v2/me');
      const me = await meRes.json();
      const deckId = me.activeDeck?.id;
      if (!deckId || me.activeDeckKind === 'system-default' || me.activeDeckKind === 'seed') {
        alert('当前是只读牌堆（系统兜底或示范牌堆），不能分享。请切到自己的牌堆后再试。');
        return;
      }
      const r = await fetch(`/api/v2/decks/${encodeURIComponent(deckId)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert('生成分享链接失败：' + (data.error || r.status));
        return;
      }
      const data = await r.json();
      const fullUrl = location.origin + data.shareUrl;
      $('libShareUrl').value = fullUrl;
      $('libShareModal').classList.remove('hidden');
    } catch (e) {
      alert('网络错误：' + e.message);
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.lib-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.lib-pane').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${name}`));
  }

  // ── Deck ───────────────────────────────────────────
  async function loadDeck() {
    try {
      const r = await fetch('/api/v2/deck');
      const data = await r.json();
      state.deck = data.cards || [];
      renderDeckStats();
      renderDeck();
      refreshBadges();
    } catch (e) { console.error(e); }
  }

  function renderDeckStats() {
    const counts = { reflection: 0, opinion: 0, analysis: 0, other: 0 };
    state.deck.forEach(c => {
      const t = c.contentType in counts ? c.contentType : 'other';
      counts[t]++;
    });
    $('statTotal').textContent = state.deck.length;
    $('statReflection').textContent = counts.reflection;
    $('statOpinion').textContent = counts.opinion;
    $('statAnalysis').textContent = counts.analysis;
  }

  function renderDeck() {
    const q = ($('deckSearch').value || '').trim().toLowerCase();
    let filtered = state.deck;

    if (state.filter !== 'all') {
      filtered = filtered.filter(c => c.contentType === state.filter);
    }
    if (q) {
      filtered = filtered.filter(c =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.suitName || '').toLowerCase().includes(q) ||
        (c.summary || '').toLowerCase().includes(q) ||
        (c.passage || '').toLowerCase().includes(q)
      );
    }

    // Sort
    const sorted = [...filtered];
    if (state.sort === 'newest') sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    else if (state.sort === 'oldest') sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    else if (state.sort === 'title') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'));
    else if (state.sort === 'type') {
      const order = { reflection: 0, opinion: 1, analysis: 2, other: 3 };
      sorted.sort((a, b) =>
        (order[a.contentType] ?? 4) - (order[b.contentType] ?? 4)
        || (b.createdAt || 0) - (a.createdAt || 0)
      );
    }

    // Meta line
    $('deckMeta').textContent = `${sorted.length} / ${state.deck.length} 张`;

    const list = $('deckList');
    if (sorted.length === 0) {
      list.innerHTML = `<div class="col-span-full p-8 text-center text-tarot-muted text-sm border border-dashed border-tarot-border rounded-xl">${state.deck.length === 0 ? '牌堆是空的，去导入页加点内容吧' : '没有匹配的牌'}</div>`;
      return;
    }

    // Build HTML — group headers if sort=type
    const html = [];
    let lastType = null;
    sorted.forEach(c => {
      if (state.sort === 'type') {
        const t = c.contentType || 'other';
        if (t !== lastType) {
          html.push(`<div class="group-header">${contentTypeLabel(t)} · ${sorted.filter(x => (x.contentType || 'other') === t).length} 张</div>`);
          lastType = t;
        }
      }
      const t = c.contentType || 'other';
      const snippet = c.summary || c.passage || '';
      html.push(`
        <div class="card-tile" data-id="${escapeAttr(c.id)}">
          <div class="tile-head">
            <span class="type-badge t-${escapeAttr(t)}">${contentTypeLabel(t)}</span>
            <button class="tile-del" data-action="del-card" data-id="${escapeAttr(c.id)}" title="删除">✕</button>
          </div>
          <h4>${escapeHtml(c.title || '—')}</h4>
          <div class="tile-snippet">${escapeHtml(snippet) || '<span class="text-tarot-muted/60 italic">无预览</span>'}</div>
          <div class="tile-foot">
            <span>${escapeHtml(c.suitName || '—')}</span>
            <span>${formatDate(c.createdAt)}</span>
          </div>
        </div>
      `);
    });
    list.innerHTML = html.join('');

    // bind tile click → modal
    list.querySelectorAll('.card-tile').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-action="del-card"]')) return;
        const id = el.dataset.id;
        openCardModal(id);
      });
    });

    // bind delete
    list.querySelectorAll('[data-action="del-card"]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('删除这张牌？')) return;
        const id = btn.dataset.id;
        const r = await fetch(`/api/v2/deck/card/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (r.ok) {
          state.deck = state.deck.filter(c => c.id !== id);
          renderDeckStats();
          renderDeck();
          refreshBadges();
        }
      });
    });
  }

  // ── Card detail modal ──────────────────────────────
  async function openCardModal(id) {
    const list = state.deck;
    const lite = list.find(c => c.id === id);
    if (!lite) return;

    $('cardModalMeta').textContent = [lite.suitName, contentTypeLabel(lite.contentType)].filter(Boolean).join(' · ');
    $('cardModalTitle').textContent = lite.title || '—';
    $('cardModalBody').innerHTML = '<p class="text-tarot-muted text-sm">加载完整内容…</p>';
    $('cardModalCount').textContent = '';
    $('cardModal').classList.remove('hidden');

    try {
      const r = await fetch(`/api/v2/deck/card/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error('not found');
      const card = await r.json();
      $('cardModalBody').innerHTML = renderCardDetailBody(card);
      $('cardModalCount').textContent = formatCount(card);
      $('cardModalBody').scrollTop = 0;
    } catch {
      $('cardModalBody').innerHTML = '<p class="text-red-600 text-sm">加载失败</p>';
    }
  }

  function closeCardModal() {
    $('cardModal').classList.add('hidden');
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
      parts.push(card.insights.map(s => `<div class="insight-card">${escapeHtml(s)}</div>`).join(''));
    }
    if (fullText && fullText.trim()) {
      parts.push(`<span class="section-label">${card.contentType === 'analysis' ? '原文' : '正文'}</span>`);
      parts.push(`<div class="passage-block">${formatPassage(fullText)}</div>`);
    } else if (parts.length === 0) {
      parts.push(`<p class="text-tarot-muted">这张牌没有正文内容</p>`);
    }
    if (card.source && (card.source.label || card.source.path)) {
      const src = card.source.label || card.source.path;
      parts.push(`<div class="source-line">来源：<code>${escapeHtml(src)}</code></div>`);
    }
    return parts.join('');
  }

  function formatPassage(text) {
    const paragraphs = String(text).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return '';
    return paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  }

  function formatCount(card) {
    const text = card.fullPassage || card.passage || '';
    return text.length ? `${text.length.toLocaleString()} 字` : '';
  }

  // ── History ────────────────────────────────────────
  async function loadHistory() {
    try {
      const r = await fetch('/api/v2/history');
      const data = await r.json();
      state.history = data.history || [];
      renderHistory();
      refreshBadges();
    } catch (e) { console.error(e); }
  }

  function renderHistory() {
    const list = $('historyList');
    if (state.history.length === 0) {
      list.innerHTML = `<div class="p-6 text-center text-tarot-muted text-sm">还没有抽牌记录</div>`;
      return;
    }
    list.innerHTML = state.history.map(h => `
      <div class="flex items-center gap-3 px-4 py-3 hover:bg-tarot-accent/40 transition">
        <div class="flex-1 min-w-0">
          <div class="text-sm text-black">
            <span class="text-xs px-1.5 py-0.5 rounded bg-tarot-accent mr-2">${h.spread === 'three' ? '三牌阵' : '日签'}</span>
            ${h.question ? escapeHtml(h.question) : '<span class="text-tarot-muted italic">（无问题）</span>'}
          </div>
          <div class="text-xs text-tarot-muted mt-0.5">
            ${formatDate(h.drawnAt)} · ${(h.cardIds || []).length} 张牌
          </div>
        </div>
        <button class="row-action" data-at="${h.drawnAt}">删除</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-at]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const at = btn.dataset.at;
        const r = await fetch(`/api/v2/history/${at}`, { method: 'DELETE' });
        if (r.ok) {
          state.history = state.history.filter(h => String(h.drawnAt) !== at);
          renderHistory();
          refreshBadges();
        }
      });
    });
  }

  // ── Dialogues ──────────────────────────────────────
  async function loadDialogues() {
    try {
      const r = await fetch('/api/v2/dialogues');
      const data = await r.json();
      state.dialogues = data.dialogues || [];
      renderDialogues();
      refreshBadges();
    } catch (e) { console.error(e); }
  }

  function renderDialogues() {
    const list = $('dialoguesList');
    if (state.dialogues.length === 0) {
      list.innerHTML = `<div class="p-6 text-center text-tarot-muted text-sm">还没有对话记录</div>`;
      return;
    }
    list.innerHTML = state.dialogues.map(d => `
      <div class="px-4 py-3 hover:bg-tarot-accent/40 transition">
        <div class="flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <div class="font-medium text-black truncate">${escapeHtml((d.cardTitles || []).join(' · ') || '—')}</div>
            <div class="text-xs text-tarot-muted mt-0.5">
              ${d.turns} 轮 · ${formatDate(d.updatedAt)}
            </div>
          </div>
          <button class="text-xs text-tarot-muted hover:text-black px-3 py-1 border border-tarot-border rounded" data-id="${escapeAttr(d.id)}" data-action="view-dlg">查看</button>
          <button class="row-action" data-id="${escapeAttr(d.id)}" data-action="del-dlg">删除</button>
        </div>
        <div class="dlg-detail hidden mt-3 p-3 bg-tarot-accent/40 rounded-lg text-xs space-y-2"></div>
      </div>
    `).join('');

    list.querySelectorAll('[data-action="view-dlg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const detail = btn.closest('.px-4').querySelector('.dlg-detail');
        if (!detail.classList.contains('hidden')) {
          detail.classList.add('hidden');
          return;
        }
        detail.innerHTML = '<div class="text-tarot-muted">加载中...</div>';
        detail.classList.remove('hidden');
        const r = await fetch(`/api/v2/dialogues/${encodeURIComponent(id)}`);
        if (!r.ok) { detail.innerHTML = '<div class="text-red-600">加载失败</div>'; return; }
        const d = await r.json();
        detail.innerHTML = (d.transcript || []).map(t =>
          `<div class="${t.role === 'ai' ? '' : 'text-right'}">
             <span class="inline-block max-w-[85%] px-3 py-1.5 rounded ${t.role === 'ai' ? 'bg-white border border-tarot-border' : 'bg-black text-white'}">${escapeHtml(t.text)}</span>
           </div>`
        ).join('') || '<div class="text-tarot-muted">空对话</div>';
      });
    });

    list.querySelectorAll('[data-action="del-dlg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('删除这段对话？')) return;
        const id = btn.dataset.id;
        const r = await fetch(`/api/v2/dialogues/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (r.ok) {
          state.dialogues = state.dialogues.filter(d => d.id !== id);
          renderDialogues();
          refreshBadges();
        }
      });
    });
  }

  // ── Account ────────────────────────────────────────
  async function loadAccount() {
    try {
      const r = await fetch('/api/v2/me/export');
      const data = await r.json();
      state.userId = data.userId || '';
      $('myUserId').value = state.userId;
    } catch (e) { console.error(e); }
  }

  async function handleRestore() {
    const id = $('restoreInput').value.trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(id)) {
      showAccountStatus('身份码格式不对（应为 32 位十六进制）', 'error');
      return;
    }
    if (id === state.userId) {
      showAccountStatus('就是当前身份，无需切换', 'warn');
      return;
    }
    if (!confirm('切换后本浏览器将看不到当前牌库（除非记得当前身份码）。继续？')) return;
    try {
      const r = await fetch('/api/v2/me/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id })
      });
      const data = await r.json();
      if (!r.ok) {
        showAccountStatus(data.error || '切换失败', 'error');
        return;
      }
      showAccountStatus('✓ 已切换，正在刷新...', 'success');
      setTimeout(() => location.reload(), 800);
    } catch {
      showAccountStatus('网络错误', 'error');
    }
  }

  function showAccountStatus(msg, type) {
    const el = $('accountStatus');
    el.classList.remove('hidden', 'bg-red-50', 'border-red-200', 'text-red-700',
      'bg-green-50', 'border-green-200', 'text-green-700',
      'bg-amber-50', 'border-amber-200', 'text-amber-700');
    const cls = ({
      error: ['bg-red-50', 'border-red-200', 'text-red-700'],
      success: ['bg-green-50', 'border-green-200', 'text-green-700'],
      warn: ['bg-amber-50', 'border-amber-200', 'text-amber-700']
    })[type] || [];
    el.classList.add(...cls);
    el.textContent = msg;
  }

  function refreshBadges() {
    $('badgeDeck').textContent = state.deck.length || '';
    $('badgeHistory').textContent = state.history.length || '';
    $('badgeDialogues').textContent = state.dialogues.length || '';
  }

  // ── utils ──────────────────────────────────────────
  function contentTypeLabel(t) {
    return ({ reflection: '反思', opinion: '观点', analysis: '洞察' })[t] || '其他';
  }
  function formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
      : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_-]/g, '');
  }
})();
