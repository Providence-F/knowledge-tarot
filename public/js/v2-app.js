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
    publicDeck: { available: false },
    activeDeck: null,            // { id, name, emoji, totalCards, kind }
    activeDeckKind: null,        // 'owned' | 'system-default' | 'seed'
    decksList: { owned: [], seeds: [], system: [] },
    isDrawing: false,
    currentDetailCard: null,     // 当前打开详情的卡（feedback 用）
    feedbackCache: {}            // { 'deckId|cardId': 'star'|'block'|null }
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    await refreshMe();
    bindEvents();
    bindOnboarding();

    // 决定首屏：
    // 1) 没 activeDeck 且没 onboardedAt -> 弹引导墙
    // 2) activeDeck 是 system-default / seed -> 直接抽牌（mode banner 视情况）
    // 3) activeDeck 是 owned + 有牌 -> 抽牌
    // 4) activeDeck 是 owned + 0 张 -> empty state
    if (!state.activeDeck && !state.user?.onboardedAt && !state.user?.activeDeckId) {
      showOnboarding();
      return;
    }
    if (state.activeDeckKind === 'system-default') {
      $('modeBanner').classList.remove('hidden');
      $('drawSection').classList.remove('hidden');
    } else if (state.deckSize === 0 && state.activeDeckKind === 'owned') {
      $('emptyState').classList.remove('hidden');
    } else {
      $('drawSection').classList.remove('hidden');
    }
    renderDeckStageHint();
  }

  function renderDeckStageHint() {
    const hint = $('deckStageHint');
    if (!hint) return;
    if (state.activeDeckKind !== 'owned') { hint.classList.add('hidden'); return; }
    const n = state.deckSize || 0;
    if (n === 0) { hint.classList.add('hidden'); return; }
    if (n < 30) {
      hint.textContent = `你的牌堆才 ${n} 张——重逢感还很弱。先去导入更多过去的笔记，等到 100 张时反向 RAG 才能完整生效。`;
      hint.classList.remove('hidden');
    } else if (n < 100) {
      hint.textContent = `你的牌堆 ${n} 张，再到 100 张体验最完整。`;
      hint.classList.remove('hidden');
    } else if (n > 1000) {
      hint.textContent = `你的牌堆已超 1000 张——重逢概率会被稀释。建议按主题拆分新 deck。`;
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  }

  async function refreshMe() {
    try {
      const r = await fetch('/api/v2/me');
      const data = await r.json();
      state.user = data.user;
      state.activeDeck = data.activeDeck;
      state.activeDeckKind = data.activeDeckKind;
      state.publicDeck = data.publicDeck || { available: false };
      state.deckSize = data.activeDeck?.totalCards || 0;

      // 顶栏 deck 信息
      const name = data.activeDeck?.name || (state.user?.mode === 'public' ? state.publicDeck.name || '系统兜底牌堆' : '');
      const emoji = data.activeDeck?.emoji || (data.activeDeckKind === 'system-default' ? '🌌' : '📚');
      const cnt = data.activeDeck?.totalCards || 0;
      const $name = $('activeDeckName'); if ($name) $name.textContent = name || '未选择';
      const $em = $('activeDeckEmoji'); if ($em) $em.textContent = emoji;
      const $emM = $('activeDeckEmojiMobile'); if ($emM) $emM.textContent = emoji;
      const badgeText = cnt > 0 ? `${cnt} 张` : '';
      $('deckBadge').textContent = badgeText;
      const dbm = $('deckBadgeMobile'); if (dbm) dbm.textContent = cnt > 0 ? `${cnt}` : '';

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
      // 模式切换按钮：保留兼容（v1.0 公共/私有切换）
      const switchBtn = $('switchModeBtn');
      if (switchBtn) {
        if (state.activeDeckKind && state.activeDeckKind !== 'owned') {
          switchBtn.textContent = '切换到我的牌堆 →';
          switchBtn.classList.remove('hidden');
        } else if (state.publicDeck.available) {
          switchBtn.textContent = '体验公共牌堆 (DEMO) →';
          switchBtn.classList.remove('hidden');
        } else {
          switchBtn.classList.add('hidden');
        }
      }
      // 公共牌堆 onboarding 描述
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

  async function fetchDecksList() {
    try {
      const r = await fetch('/api/v2/decks');
      if (!r.ok) return;
      state.decksList = await r.json();
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

    // 顶栏菜单内"模式切换"
    const switchModeBtn = $('switchModeBtn');
    if (switchModeBtn) {
      switchModeBtn.addEventListener('click', async () => {
        const target = state.user?.mode === 'public' ? 'private' : 'public';
        if (target === 'public' && !state.publicDeck.available) {
          alert('公共牌堆暂未就绪');
          return;
        }
        if (!confirm(target === 'private' ? '切换到你自己的牌堆？' : '切换到公共牌堆 (DEMO 模式，抽牌不会保存)？')) return;
        try {
          const r = await fetch('/api/v2/me/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: target })
          });
          if (!r.ok) throw new Error('切换失败');
          if (target === 'private' && state.deckSize === 0) {
            window.location.href = 'v2-import.html';
          } else {
            location.reload();
          }
        } catch { alert('切换失败，请刷新重试'); }
      });
    }

    document.querySelectorAll('.spread-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.spread-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentSpread = btn.dataset.spread;
      });
    });

    $('qInput1').addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleDraw();
      }
    });
    document.querySelectorAll('.question-example').forEach(btn => {
      btn.addEventListener('click', () => {
        $('qInput1').value = btn.textContent.trim();
        $('qInput1').focus();
      });
    });

    $('drawBtn').addEventListener('click', handleDraw);
    $('redrawBtn').addEventListener('click', handleDraw);

    // 第一反应 → 接桥 / 收尾
    $('askDeeperBtn').addEventListener('click', submitReactionAndStartDialogue);
    $('finishReactionBtn').addEventListener('click', finishWithoutAI);

    // 全局深度对话（在接桥后才生效）
    $('openDialogueBtn')?.addEventListener('click', openGlobalDialogue);

    // 卡片详情 modal
    $('cardDetailOverlay').addEventListener('click', closeCardDetail);
    $('cardDetailClose').addEventListener('click', closeCardDetail);

    // 反馈按钮（⭐ / 🚫 / 清除）
    $('cardFeedbackBtns').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-fb]');
      if (!btn) return;
      const kind = btn.dataset.fb; // 'star' | 'block' | 'clear'
      const card = state.currentDetailCard;
      if (!card || !card.id) return;
      const deckId = (card._deckId) || state.activeDeck?.id;
      if (!deckId) {
        $('cardFeedbackStatus').textContent = '示范牌堆不支持反馈';
        return;
      }
      btn.disabled = true;
      try {
        const r = await fetch('/api/v2/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckId, cardId: card.id, kind })
        });
        if (!r.ok) throw new Error('feedback failed');
        const stored = (kind === 'clear') ? null : kind;
        state.feedbackCache[`${deckId}|${card.id}`] = stored;
        renderCardFeedbackState(stored);
      } catch {
        $('cardFeedbackStatus').textContent = '保存失败';
      } finally {
        btn.disabled = false;
      }
    });

    // 深度对话 modal
    $('dialogueOverlay').addEventListener('click', closeDialogue);
    $('dialogueClose').addEventListener('click', closeDialogue);
    $('dialogueSend').addEventListener('click', sendDialogue);
    $('dialogueInput').addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendDialogue();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('cardDetailModal').classList.contains('hidden')) closeCardDetail();
      else if (!$('dialogueModal').classList.contains('hidden')) closeDialogue();
      else if (!$('deckDrawer').classList.contains('hidden')) closeDeckDrawer();
      else if (!$('shareModal').classList.contains('hidden')) $('shareModal').classList.add('hidden');
    });

    // 牌堆切换器
    const dsBtn = $('deckSwitcherBtn'); if (dsBtn) dsBtn.addEventListener('click', openDeckDrawer);
    const dsBtnM = $('deckSwitcherBtnMobile'); if (dsBtnM) dsBtnM.addEventListener('click', openDeckDrawer);
    $('deckDrawerClose').addEventListener('click', closeDeckDrawer);
    $('deckDrawerOverlay').addEventListener('click', closeDeckDrawer);
    $('manageBtn').addEventListener('click', () => { window.location.href = 'v2-library.html'; });

    // 分享 modal
    $('shareModalClose').addEventListener('click', () => $('shareModal').classList.add('hidden'));
    $('shareModalOverlay').addEventListener('click', () => $('shareModal').classList.add('hidden'));
    $('shareCopyBtn').addEventListener('click', async () => {
      const url = $('shareUrlInput').value;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        $('shareUrlInput').select();
        document.execCommand('copy');
      }
      const hint = $('shareCopyHint');
      hint.classList.remove('hidden');
      setTimeout(() => hint.classList.add('hidden'), 2000);
    });
  }

  // ── 牌堆切换器 ────────────────────────────────────────
  async function openDeckDrawer() {
    $('deckDrawer').classList.remove('hidden');
    await fetchDecksList();
    renderDeckDrawer();
  }
  function closeDeckDrawer() {
    $('deckDrawer').classList.add('hidden');
  }
  function renderDeckDrawer() {
    const body = $('deckDrawerBody');
    const { owned = [], seeds = [], system = [] } = state.decksList;
    const activeId = state.decksList.activeDeckId;

    function row(d, opts = {}) {
      const isActive = d.id === activeId || d.isActive;
      const badge = opts.badge ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-tarot-accent text-tarot-muted ml-1">${opts.badge}</span>` : '';
      const actions = opts.kind === 'owned'
        ? `<div class="deck-row-actions">
            ${isActive ? '<span class="deck-row-tick">●</span>' : ''}
            <button class="deck-row-delete" data-action="delete-deck" data-deck-id="${escapeAttr(d.id)}" type="button">删除</button>
          </div>`
        : (isActive ? '<span class="deck-row-tick">●</span>' : '');
      return `
        <div class="deck-row ${isActive ? 'is-active' : ''}" data-deck-id="${escapeAttr(d.id)}" data-kind="${opts.kind}">
          <div class="deck-row-emoji">${escapeHtml(d.emoji || '📚')}</div>
          <div class="deck-row-meta">
            <div class="deck-row-name">${escapeHtml(d.name || '未命名')}${badge}</div>
            <div class="deck-row-sub">${d.totalCards || 0} 张 · ${escapeHtml((d.description || '').slice(0, 40))}</div>
          </div>
          ${actions}
        </div>
      `;
    }

    let html = '';
    if (owned.length > 0) {
      html += '<div class="deck-section-title">我的牌堆</div>';
      html += owned.map(d => row(d, { kind: 'owned' })).join('');
    }
    if (system.length > 0) {
      html += '<div class="deck-section-title mt-3">系统兜底</div>';
      html += system.map(d => row(d, { kind: 'system-default' })).join('');
    }
    if (seeds.length > 0) {
      html += '<div class="deck-section-title mt-3">示范牌堆 · 可克隆</div>';
      html += seeds.map(d => row(d, { kind: 'seed', badge: '示范' })).join('');
    }
    if (!html) html = '<div class="text-xs text-tarot-muted text-center py-6">没有牌堆——先去新建一个</div>';
    body.innerHTML = html;

    body.querySelectorAll('.deck-row').forEach(el => {
      el.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-action="delete-deck"]')) return;
        const id = el.dataset.deckId;
        const kind = el.dataset.kind;
        if (kind === 'seed') {
          if (!confirm(`将"${el.querySelector('.deck-row-name').textContent.trim()}"克隆为我的牌堆？`)) return;
          const r = await fetch(`/api/v2/seed-decks/${encodeURIComponent(id)}/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!r.ok) { alert('克隆失败'); return; }
          const data = await r.json();
          await fetch(`/api/v2/decks/${data.deckId}/activate`, { method: 'POST' });
        } else {
          const r = await fetch(`/api/v2/decks/${encodeURIComponent(id)}/activate`, { method: 'POST' });
          if (!r.ok) { alert('切换失败'); return; }
        }
        closeDeckDrawer();
        location.reload();
      });
    });

    body.querySelectorAll('[data-action="delete-deck"]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const id = btn.dataset.deckId;
        const deck = owned.find(d => d.id === id);
        if (!deck) return;
        const isActive = id === activeId || deck.isActive;
        const msg = isActive
          ? `删除当前正在使用的牌堆「${deck.name || '未命名'}」？\n删除后会自动切换到其他可用牌堆或系统兜底。\n\n这会删除 ${deck.totalCards || 0} 张牌，无法恢复。抽牌历史不会自动删除。`
          : `删除「${deck.name || '未命名'}」？\n这会删除这副牌堆中的 ${deck.totalCards || 0} 张牌，无法恢复。抽牌历史不会自动删除。`;
        if (!confirm(msg)) return;
        const r = await fetch(`/api/v2/decks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          alert(`删除失败：${data.error || r.status}`);
          return;
        }
        if (isActive) {
          location.reload();
          return;
        }
        await fetchDecksList();
        renderDeckDrawer();
      });
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
  function readQuestionStruct() {
    const q1 = ($('qInput1')?.value || '').trim().slice(0, 200);
    const q2 = ($('qInput2')?.value || '').trim().slice(0, 200);
    const q3 = ($('qInput3')?.value || '').trim().slice(0, 200);
    if (!q1 && !q2 && !q3) return null;
    return { q1, q2, q3 };
  }
  function questionToText(q) {
    if (!q) return '';
    if (typeof q === 'string') return q;
    return [q.q1 && `想问的：${q.q1}`, q.q2 && `隐约觉得：${q.q2}`, q.q3 && `最害怕：${q.q3}`].filter(Boolean).join(' / ');
  }

  async function handleDraw() {
    if (state.isDrawing) return;
    const question = readQuestionStruct();
    const spread = state.currentSpread;
    state.currentQuestion = question;
    state.currentDrawnAt = null;
    state.isDrawing = true;
    setDrawBusy(true);

    $('cardsArea').classList.remove('hidden');
    $('drawContext').classList.remove('hidden');
    $('drawContext').innerHTML = renderDrawContext(question, spread);
    $('drawStatus').classList.remove('hidden');
    $('drawStatus').textContent = '正在从你过去的笔记里抽出一段…';
    $('cardsContainer').innerHTML = '';
    $('reactionSection')?.classList.add('hidden');
    if ($('aiBridge')) $('aiBridge').innerHTML = '';
    $('cardsArea').scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const r = await fetch(`/api/v2/draw/${spread}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, deckId: state.activeDeck?.id || null })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '抽牌失败');

      const cards = spread === 'single' ? [data.card] : data.cards;
      const dynamicTitles = spread === 'single'
        ? [data.dynamicTitle || '（待命名）']
        : (data.dynamicTitles || cards.map(() => '（待命名）'));
      // 只用 dynamicTitle，不污染 card.title
      cards.forEach((c, i) => {
        c._dynamicTitle = dynamicTitles[i];
        c._deckId = state.activeDeck?.id || null;
      });
      state.currentCards = cards;
      state.currentDrawnAt = data.drawnAt || null;

      $('drawStatus').textContent = data.recycled
        ? '你最近抽过的卡都已经在你脑子里了——这次允许重逢一张已经见过的。'
        : '牌已经翻开。先看抽象的标题，原文藏在翻面后。';
      renderCards(cards);
      await sleep(cards.length * 300 + 600);
      $('drawStatus').classList.add('hidden');

      // 默认陌生化展示。给用户输入"第一反应"的入口
      $('reactionSection')?.classList.remove('hidden');
      $('reactionInput').value = '';
      $('reactionInput').focus();
    } catch (e) {
      $('drawStatus').classList.add('hidden');
      $('drawContext').innerHTML = `<div class="text-red-600 inline-block px-4 py-3 rounded-2xl bg-red-50 border border-red-200">✗ ${escapeHtml(e.message)}</div>`;
    } finally {
      state.isDrawing = false;
      setDrawBusy(false);
    }
  }

  function setDrawBusy(busy) {
    const drawBtn = $('drawBtn');
    const redrawBtn = $('redrawBtn');
    drawBtn.disabled = busy;
    redrawBtn.disabled = busy;
    drawBtn.classList.toggle('opacity-50', busy);
    redrawBtn.classList.toggle('opacity-50', busy);
    drawBtn.querySelector('span').textContent = busy ? '抽牌中…' : '抽牌';
  }

  function renderDrawContext(question, spread) {
    const deckName = state.activeDeck?.name || '当前牌堆';
    const spreadName = spread === 'three' ? '三牌阵' : '日签';
    const text = questionToText(question);
    const q = text
      ? `<div class="text-black font-medium">${escapeHtml(text)}</div>`
      : `<div class="text-black font-medium">没有具体问题，作为一次随机重逢</div>`;
    return `
      <div class="inline-block max-w-full px-4 py-3 rounded-2xl bg-white border border-tarot-border text-left">
        <div class="text-[11px] text-tarot-muted mb-1">${escapeHtml(deckName)} · ${spreadName}</div>
        ${q}
      </div>
    `;
  }

  function renderCards(cards) {
    const list = $('cardsContainer');
    list.innerHTML = '';
    cards.forEach((card, idx) => {
      const slot = document.createElement('div');
      slot.className = 'flex flex-col items-center';
      if (card.positionName) {
        const label = document.createElement('div');
        label.className = 'position-outer-label';
        label.textContent = card.positionName;
        slot.appendChild(label);
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'card-wrapper cursor-pointer';
      wrapper.dataset.cardId = card.id;
      wrapper.title = '点击查看完整内容';
      const orientationMark = card.orientation === 'reversed'
        ? `<span class="text-[10px] px-1.5 py-0.5 border border-black/40 rounded text-black/70 ml-2">逆位</span>`
        : '';
      wrapper.innerHTML = `
        <div class="card-inner">
          <div class="card-face card-back">
            <svg class="card-back-pattern" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="0.8" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
            </svg>
          </div>
          <div class="card-face card-front suit-${escapeAttr(card.suit)} ${card.orientation === 'reversed' ? 'rotate-180' : ''}">
            ${card.positionName ? `<div class="position-label">${escapeHtml(card.positionName)}</div>` : ''}
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs text-tarot-muted">过去的你${orientationMark}</span>
            </div>
            <h3 class="font-serif font-bold text-2xl text-black mb-3 leading-snug">${escapeHtml(card._dynamicTitle || card.title || '—')}</h3>
            <div class="flex-1 overflow-hidden text-sm text-tarot-ivory leading-relaxed italic">
              ${renderCardFrontTeaser(card)}
            </div>
            <div class="mt-3 pt-2 text-[11px] text-tarot-muted text-center border-t border-tarot-border">
              翻面看原文 · 来源
            </div>
          </div>
        </div>
      `;
      slot.appendChild(wrapper);
      list.appendChild(slot);

      setTimeout(() => wrapper.classList.add('flipped'), 200 + idx * 300);

      wrapper.addEventListener('click', () => {
        if (!wrapper.classList.contains('flipped')) return;
        openCardDetail(card);
      });
    });
  }

  // 卡正面只展示一行抽象提示，原文 / 来源 / 日期都藏在翻面后（陌生化）
  function renderCardFrontTeaser(card) {
    const hint = card.contentType === 'opinion'
      ? '一句你曾经认同的话'
      : (card.contentType === 'analysis' ? '一段你过去整理过的判断' : '一段过去的你写过的话');
    return `<p class="opacity-70 text-center mt-6">${escapeHtml(hint)}</p>`;
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
    state.currentDetailCard = card;
    $('cardDetailMeta').textContent = [
      card.suitName || '',
      card.positionName || ''
    ].filter(Boolean).join(' · ');
    $('cardDetailTitle').textContent = card.title || '—';
    $('cardDetailBody').innerHTML = renderCardDetailBody(card);
    $('cardDetailCount').textContent = formatCount(card);
    $('cardDetailModal').classList.remove('hidden');
    setTimeout(() => $('cardDetailBody').scrollTop = 0, 30);

    // 拉取反馈状态
    loadAndRenderFeedback(card);

    // 旧数据没有 fullPassage 时，向后端拉一次完整 card
    if (!card.fullPassage && card.id) {
      const loading = $('cardDetailLoading');
      loading.classList.remove('hidden');
      try {
        const deckQ = state.activeDeck?.id ? `?deckId=${encodeURIComponent(state.activeDeck.id)}` : '';
        const r = await fetch(`/api/v2/deck/card/${encodeURIComponent(card.id)}${deckQ}`);
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
    state.currentDetailCard = null;
    $('cardDetailModal').classList.add('hidden');
  }

  async function loadAndRenderFeedback(card) {
    const deckId = (card._deckId) || state.activeDeck?.id;
    if (!deckId || !card.id) {
      renderCardFeedbackState(null, true);
      return;
    }
    const key = `${deckId}|${card.id}`;
    if (key in state.feedbackCache) {
      renderCardFeedbackState(state.feedbackCache[key]);
      return;
    }
    renderCardFeedbackState(null);
    try {
      const r = await fetch(`/api/v2/feedback?deckId=${encodeURIComponent(deckId)}`);
      if (!r.ok) return;
      const data = await r.json();
      const map = data.feedback || {};
      const kind = map[card.id] || null;
      state.feedbackCache[key] = kind;
      // 仅当 modal 还在显示同一张卡时刷新
      if (state.currentDetailCard?.id === card.id) renderCardFeedbackState(kind);
    } catch {}
  }

  function renderCardFeedbackState(kind, disabled = false) {
    const btns = $('cardFeedbackBtns').querySelectorAll('button[data-fb]');
    btns.forEach(b => {
      const isActive = (kind === 'star' && b.dataset.fb === 'star') ||
                       (kind === 'block' && b.dataset.fb === 'block');
      b.classList.toggle('bg-black', isActive);
      b.classList.toggle('text-white', isActive);
      b.classList.toggle('border-black', isActive);
      b.disabled = disabled;
      b.style.opacity = disabled ? '0.4' : '';
    });
    const status = $('cardFeedbackStatus');
    if (disabled) status.textContent = '（示范牌堆不支持）';
    else if (kind === 'star') status.textContent = '已熟悉 → 抽到概率降低';
    else if (kind === 'block') status.textContent = '已屏蔽 → 不会再抽到';
    else status.textContent = '';
  }

  function renderCardDetailBody(card) {
    const parts = [];
    const fullText = card.fullPassage || card.passage || '';

    if (card.summary) {
      parts.push(`<span class="section-label">核心</span>`);
      parts.push(`<p class="lead">${escapeHtml(card.summary)}</p>`);
    }

    if (card.contentType === 'analysis' && Array.isArray(card.insights) && card.insights.length) {
      parts.push(`<span class="section-label">要点</span>`);
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

  // ── 第一反应 → 接桥 / 收尾 ──────────────────────────
  async function submitReactionAndStartDialogue() {
    const reaction = ($('reactionInput').value || '').trim();
    if (!reaction) {
      $('reactionInput').focus();
      $('reactionInput').classList.add('ring-2', 'ring-red-200');
      setTimeout(() => $('reactionInput').classList.remove('ring-2', 'ring-red-200'), 1200);
      return;
    }
    const cards = state.currentCards || [];
    if (cards.length === 0) return;

    const askBtn = $('askDeeperBtn');
    askBtn.disabled = true;
    askBtn.classList.add('opacity-60');
    $('aiBridge').classList.remove('hidden');
    $('aiBridge').innerHTML = `<div class="flex items-center gap-3 text-tarot-muted py-2"><div class="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"></div><span>过去的你正在说话…</span></div>`;

    try {
      const r = await fetch('/api/v2/dialogue/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: cards[0].id,
          userQuestion: state.currentQuestion,
          userReaction: reaction,
          deckId: state.activeDeck?.id || null,
          drawnAt: state.currentDrawnAt
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '接桥失败');

      const ackHtml = data.ack ? `<div class="text-tarot-ivory">${escapeHtml(data.ack)}</div>` : '';
      const qHtml = data.question
        ? `<p class="italic leading-relaxed border-l-2 border-black pl-4 text-tarot-ivory">${escapeHtml(data.question)}</p>`
        : '';
      const continueBtn = data.question
        ? `<div class="pt-3 flex justify-end">
             <button id="openDialogueBtn2" class="px-5 py-2 rounded-full bg-black text-white text-sm hover:bg-tarot-ivory transition">继续这个问题</button>
           </div>`
        : '';
      $('aiBridge').innerHTML = ackHtml + qHtml + continueBtn;
      // 把第一反应和 AI 接桥写进 dialogueState 作为后续 transcript 起点
      state.openerAck = data.ack || '';
      state.openerQuestion = data.question || '';
      state.userReaction = reaction;
      $('openDialogueBtn2')?.addEventListener('click', openGlobalDialogue);
    } catch (e) {
      $('aiBridge').innerHTML = `<div class="text-red-600">✗ ${escapeHtml(e.message)}</div>`;
    } finally {
      askBtn.disabled = false;
      askBtn.classList.remove('opacity-60');
    }
  }

  function finishWithoutAI() {
    const reaction = ($('reactionInput').value || '').trim();
    if (reaction && state.currentDrawnAt) {
      // 静默落盘 userReaction（不调 LLM）
      fetch('/api/v2/dialogue/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: (state.currentCards || [])[0]?.id,
          userQuestion: state.currentQuestion,
          userReaction: reaction,
          deckId: state.activeDeck?.id || null,
          drawnAt: state.currentDrawnAt
        })
      }).catch(() => {});
    }
    $('aiBridge').classList.remove('hidden');
    $('aiBridge').innerHTML = `<p class="text-tarot-muted italic text-sm">把这个反应也带走。下一次它会以新的牌回来找你。</p>`;
  }

  // ── 深度对话（全局，针对当前抽出的所有牌） ──────────
  let dialogueState = { cards: [], dialogueId: null, transcript: [], userQuestion: '' };
  let dialogueAbortController = null;

  function openGlobalDialogue() {
    const cards = state.currentCards || [];
    if (cards.length === 0) return;
    if (dialogueAbortController) { dialogueAbortController.abort(); dialogueAbortController = null; }
    // 把第一反应和接桥的 ack/question 灌入 transcript 作为对话起点
    const seed = [];
    if (state.userReaction) seed.push({ role: 'user', text: state.userReaction });
    const aiOpener = [state.openerAck, state.openerQuestion].filter(Boolean).join('\n').trim();
    if (aiOpener) seed.push({ role: 'ai', text: aiOpener });
    dialogueState = {
      cards,
      dialogueId: null,
      transcript: seed,
      userQuestion: state.currentQuestion || '',
      drawnAt: state.currentDrawnAt
    };

    const titleText = cards.length === 1
      ? (cards[0]._dynamicTitle || cards[0].title)
      : cards.map(c => c._dynamicTitle || c.title).join(' · ');
    const metaText = cards.length === 1
      ? `过去的你 · ${cards[0].positionName || '日签'}`
      : `三牌阵 · 整体对话`;

    $('dialogueCardSuit').textContent = metaText;
    $('dialogueCardTitle').textContent = titleText;

    $('dialogueScroll').innerHTML = '';
    seed.forEach(t => appendDialogue(t.role, t.text));
    if (seed.length === 0) {
      $('dialogueScroll').innerHTML = `<div class="text-tarot-muted text-xs italic text-center py-2">围绕这副牌的对话开始。AI 只问问题，不会给你答案。最多 3 轮。</div>`;
    }
    $('dialogueModal').classList.remove('hidden');
    $('dialogueInput').value = '';
    setTimeout(() => $('dialogueScroll').scrollTop = $('dialogueScroll').scrollHeight, 50);
    // 不再 auto-aiAsk，等用户先输入下一句
  }

  function closeDialogue() {
    if (dialogueAbortController) { dialogueAbortController.abort(); dialogueAbortController = null; }
    $('dialogueModal').classList.add('hidden');
  }

  async function aiAsk() {
    if (dialogueAbortController) { dialogueAbortController.abort(); }
    const ctl = new AbortController();
    dialogueAbortController = ctl;
    appendDialogue('ai', '...', true);
    try {
      const r = await fetch('/api/v2/dialogue/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardIds: dialogueState.cards.map(c => c.id),
          dialogueId: dialogueState.dialogueId,
          transcript: dialogueState.transcript,
          userQuestion: dialogueState.userQuestion,
          deckId: state.activeDeck?.id || null,
          drawnAt: dialogueState.drawnAt || null
        }),
        signal: ctl.signal
      });
      if (ctl.signal.aborted) return;
      const data = await r.json();
      removeLoading();
      if (!r.ok) throw new Error(data.error || '对话失败');
      // T17: 三轮收尾
      if (data.exhausted) {
        const node = document.createElement('div');
        node.className = 'flex justify-center py-3';
        node.innerHTML = `<div class="max-w-[90%] text-center text-sm text-tarot-muted italic border-t border-tarot-border pt-3">${escapeHtml(data.finalMessage || '今天的对话先到这里。')}</div>`;
        $('dialogueScroll').appendChild(node);
        $('dialogueScroll').scrollTop = $('dialogueScroll').scrollHeight;
        $('dialogueInput').disabled = true;
        $('dialogueInput').placeholder = '今天到此为止 · 把刚才想到的写到 Obsidian 里';
        return;
      }
      const q = data.question || '...';
      if (data.dialogueId) dialogueState.dialogueId = data.dialogueId;
      dialogueState.transcript.push({ role: 'ai', text: q });
      appendDialogue('ai', q);
      if (typeof data.turnsRemaining === 'number' && data.turnsRemaining === 0) {
        const tip = document.createElement('div');
        tip.className = 'flex justify-center pt-1';
        tip.innerHTML = `<div class="text-[11px] text-tarot-muted italic">最后一轮 — 写完这条之后 AI 不会再问。</div>`;
        $('dialogueScroll').appendChild(tip);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      removeLoading();
      // 不把失败的"AI 问题"写进 transcript（避免污染上下文）
      const node = document.createElement('div');
      node.className = 'flex justify-start';
      node.innerHTML = `
        <div class="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-red-50 border border-red-200 text-red-700 flex items-center gap-3">
          <span>（AI 暂时没接上）</span>
          <button class="px-2 py-0.5 text-xs border border-red-300 rounded hover:bg-red-100 transition" data-action="retry-ai">重试</button>
        </div>
      `;
      $('dialogueScroll').appendChild(node);
      $('dialogueScroll').scrollTop = $('dialogueScroll').scrollHeight;
      node.querySelector('[data-action="retry-ai"]').addEventListener('click', () => {
        node.remove();
        aiAsk();
      });
    } finally {
      if (dialogueAbortController === ctl) dialogueAbortController = null;
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
