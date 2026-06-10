// app.js — Main application module (ES module)

import { loadDeck, drawCards } from './deck.js';
import { renderSpread, flipAllCardsSequentially, renderReading, renderDeepDive, showEmptyState, exportReading } from './renderer.js';
import { isCloudMode, requestInterpretation } from './ai.js';

let deck = null;
let currentCards = [];
let currentQuestion = '';
let currentInterpretation = '';

/**
 * Initialize the app.
 */
async function init() {
  try {
    showLoading(true);
    deck = await loadDeck();
    displayStats(deck);
    setupEventListeners();
  } catch (err) {
    showError('无法加载牌组数据。请先运行 npm run build 构建牌组。');
    console.error('[init]', err);
  } finally {
    showLoading(false);
  }
}

/**
 * Display deck statistics.
 */
function displayStats(deck) {
  const cards = deck.cards || deck;
  const totalEl = document.getElementById('stat-total');
  if (totalEl) totalEl.textContent = `${cards.length} 张牌`;

  // Count by suit
  const suitCounts = {};
  for (const card of cards) {
    suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
  }

  const SUIT_LABELS = {
    'sword-of-self': '自我之剑',
    'mirror-of-world': '世界之镜',
    'compass-of-method': '方法之罗盘',
    'ship-of-action': '行动之舟',
    'seed-of-growth': '成长之种',
  };

  const statSuits = document.getElementById('stat-suits');
  if (statSuits) {
    const parts = Object.entries(suitCounts).map(([suit, count]) => {
      const label = SUIT_LABELS[suit] || suit;
      return `${label}(${count})`;
    });
    statSuits.textContent = parts.join('  ');
  }
}

/**
 * Set up all event listeners.
 */
function setupEventListeners() {
  // Draw button
  const drawBtn = document.getElementById('draw-btn');
  if (drawBtn) {
    drawBtn.addEventListener('click', handleDraw);
  }

  // Spread type buttons
  const spreadBtns = document.querySelectorAll('.spread-btn');
  for (const btn of spreadBtns) {
    btn.addEventListener('click', () => {
      spreadBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  // Privacy toggle
  const privacySwitch = document.getElementById('privacy-switch');
  if (privacySwitch) {
    privacySwitch.addEventListener('click', () => {
      const isChecked = privacySwitch.getAttribute('aria-checked') === 'true';
      privacySwitch.setAttribute('aria-checked', String(!isChecked));
      privacySwitch.classList.toggle('active', !isChecked);

      const modeLabel = document.getElementById('mode-label');
      if (modeLabel) modeLabel.textContent = isChecked ? '本地模式' : '云端模式';

      const tooltip = document.getElementById('privacy-tooltip');
      if (tooltip) tooltip.classList.toggle('hidden', isChecked);
    });
  }

  // Card click for deep dive (delegated)
  const spreadArea = document.getElementById('spread-area');
  if (spreadArea) {
    spreadArea.addEventListener('click', (e) => {
      const cardEl = e.target.closest('.card');
      if (cardEl && cardEl._cardData) {
        renderDeepDive(cardEl._cardData);
      }
    });
  }

  // Deep dive overlay close
  const deepDiveOverlay = document.getElementById('deep-dive-overlay');
  const deepDiveClose = document.getElementById('deep-dive-close');
  if (deepDiveClose) {
    deepDiveClose.addEventListener('click', () => {
      if (deepDiveOverlay) deepDiveOverlay.classList.add('hidden');
    });
  }
  if (deepDiveOverlay) {
    deepDiveOverlay.addEventListener('click', (e) => {
      if (e.target === deepDiveOverlay) deepDiveOverlay.classList.add('hidden');
    });
  }

  // Save/export button
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', handleExport);
  }

  // Redraw button
  const redrawBtn = document.getElementById('redraw-btn');
  if (redrawBtn) {
    redrawBtn.addEventListener('click', handleReset);
  }
}

/**
 * Handle the draw action.
 */
async function handleDraw() {
  const textarea = document.getElementById('user-question');
  const question = textarea?.value?.trim();

  if (!question) {
    showToast('请输入你的问题');
    return;
  }

  const activeBtn = document.querySelector('.spread-btn.active');
  const spreadType = activeBtn?.dataset?.spread || 'three';

  // Disable button during draw
  setDrawEnabled(false);
  currentQuestion = question;

  // Show spread area
  const spreadArea = document.getElementById('spread-area');
  if (spreadArea) spreadArea.classList.remove('hidden');

  try {
    // Draw cards
    const cards = drawCards(deck, question, spreadType);
    currentCards = cards;

    if (cards.length === 0) {
      showEmptyState('当前牌组');
      return;
    }

    // Render face-down cards
    const cardElements = renderSpread(cards, spreadType);

    // Wait a moment, then flip sequentially
    await new Promise(r => setTimeout(r, 500));
    await flipAllCardsSequentially(cardElements, 600);

    // Show reading
    await handleInterpretation(question, cards);

    // Show action buttons
    showActionButtons(true);
  } catch (err) {
    console.error('[draw]', err);
    showToast('抽牌失败，请重试');
  } finally {
    setDrawEnabled(true);
  }
}

/**
 * Handle AI interpretation or local summary.
 */
async function handleInterpretation(question, cards) {
  const section = document.getElementById('reading-area');
  const container = document.getElementById('reading-content');
  if (!section || !container) return;

  section.classList.remove('hidden');

  if (isCloudMode()) {
    // Show loading spinner
    const indicator = document.getElementById('source-indicator');
    if (indicator) indicator.textContent = '';
    container.innerHTML = '<div class="reading-loading text-center py-8"><div class="spinner mx-auto mb-4 w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin"></div><p class="text-muted">AI 正在解读...</p></div>';

    try {
      // Filter out private cards
      const cloudCards = cards.filter(c => !c.private);
      if (cloudCards.length === 0) {
        renderLocalReading(cards);
        return;
      }

      const result = await requestInterpretation(question, cloudCards);
      currentInterpretation = result.interpretation;
      renderReading(result.interpretation, result.source);

      if (result.warning) {
        showToast(result.warning);
      }
    } catch (err) {
      console.error('[interpret]', err);
      renderLocalReading(cards);
    }
  } else {
    renderLocalReading(cards);
  }
}

/**
 * Show card summaries in local mode.
 */
function renderLocalReading(cards) {
  const section = document.getElementById('reading-area');
  const container = document.getElementById('reading-content');
  if (!section || !container) return;

  section.classList.remove('hidden');

  const indicator = document.getElementById('source-indicator');
  if (indicator) indicator.textContent = '📋 本地模式';

  let html = '';
  for (const card of cards) {
    html += `
      <div class="reading-section mb-6">
        <h3 class="font-cinzel tracking-wide mb-2 font-semibold">【${card.position}】${card.title}</h3>
        <p>${card.summary || card.hook || ''}</p>
        ${card.scenario ? `<p class="text-muted mt-2 text-sm">适用：${card.scenario}</p>` : ''}
      </div>`;
  }

  currentInterpretation = html;
  container.innerHTML = html;
}

/**
 * Handle export to markdown.
 */
function handleExport() {
  if (!currentCards.length || !currentQuestion) {
    showToast('没有可导出的解读');
    return;
  }

  const md = exportReading(currentQuestion, currentCards, currentInterpretation);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `知识塔罗-${new Date().toISOString().split('T')[0]}.md`;
  a.click();

  URL.revokeObjectURL(url);
  showToast('解读已导出');
}

/**
 * Handle reset for a new question.
 */
function handleReset() {
  const textarea = document.getElementById('user-question');
  if (textarea) textarea.value = '';

  // Hide spread area and clear card slots
  const spreadArea = document.getElementById('spread-area');
  const singleSpread = document.getElementById('spread-single');
  const threeSpread = document.getElementById('spread-three');

  if (spreadArea) spreadArea.classList.add('hidden');
  if (singleSpread) {
    singleSpread.classList.add('hidden');
    const slot = singleSpread.querySelector('.card-slot');
    if (slot) slot.innerHTML = '';
  }
  if (threeSpread) {
    threeSpread.classList.add('hidden');
    threeSpread.querySelectorAll('.card-slot').forEach(slot => slot.innerHTML = '');
  }

  // Hide reading area
  const readingSection = document.getElementById('reading-area');
  const readingContent = document.getElementById('reading-content');
  if (readingSection) readingSection.classList.add('hidden');
  if (readingContent) readingContent.innerHTML = '';

  // Hide empty state
  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.classList.add('hidden');

  currentCards = [];
  currentQuestion = '';
  currentInterpretation = '';

  showActionButtons(false);
}

/**
 * Show/hide action buttons after a reading.
 */
function showActionButtons(show) {
  const saveBtn = document.getElementById('save-btn');
  const redrawBtn = document.getElementById('redraw-btn');
  if (saveBtn) saveBtn.classList.toggle('hidden', !show);
  if (redrawBtn) redrawBtn.classList.toggle('hidden', !show);
}

/**
 * Enable/disable the draw button.
 */
function setDrawEnabled(enabled) {
  const btn = document.getElementById('draw-btn');
  if (btn) {
    btn.disabled = !enabled;
    btn.textContent = enabled ? '开始抽牌' : '抽牌中...';
  }
}

/**
 * Show loading overlay.
 */
function showLoading(show) {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.toggle('hidden', !show);
}

/**
 * Show a toast message.
 */
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('toast-visible');
  setTimeout(() => toast.classList.remove('toast-visible'), 3000);
}

/**
 * Show error message in the main area.
 */
function showError(msg) {
  const main = document.getElementById('spread-area') || document.querySelector('main');
  if (main) {
    main.innerHTML = `<div class="error-state"><p>${msg}</p></div>`;
  }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
