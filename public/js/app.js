import { loadDeck, drawDaily, drawThree } from './deck.js';
import { renderCardBack, flipCard, renderInterpretation, renderDeepDive, renderEmptyState } from './renderer.js';
import { getInterpretation, getFallbackInterpretation, getPrivacyMode, setPrivacyMode } from './ai.js';

let deck = null;
let currentCards = [];
let currentQuestion = '';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function init() {
  try {
    showLoading(true);
    deck = await loadDeck();
    const cards = deck.cards || deck;
    updateStats(cards);
    bindEvents();
  } catch (err) {
    showError('无法加载牌组数据。请先运行 npm run build 构建牌组。');
    console.error('[init]', err);
  } finally {
    showLoading(false);
  }
}

function updateStats(cards) {
  const totalEl = document.getElementById('stat-total');
  const suitsEl = document.getElementById('stat-suits');
  if (totalEl) totalEl.textContent = `${cards.length} 张牌`;
  if (suitsEl) {
    const counts = {};
    for (const c of cards) {
      const s = c.suit || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    const labels = { 'sword-of-self': '自我之剑', 'mirror-of-world': '世界之镜', 'compass-of-method': '方法之罗盘', 'ship-of-action': '行动之舟', 'seed-of-growth': '成长之种' };
    suitsEl.textContent = Object.entries(counts)
      .filter(([k]) => k !== 'unknown')
      .map(([k, v]) => `${labels[k] || k}(${v})`)
      .join(' ');
  }
}

function bindEvents() {
  const drawBtn = document.getElementById('draw-btn');
  if (drawBtn) drawBtn.addEventListener('click', handleDraw);

  const redrawBtn = document.getElementById('redraw-btn');
  if (redrawBtn) redrawBtn.addEventListener('click', handleDraw);

  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  const spreadBtns = document.querySelectorAll('.spread-btn');
  for (const btn of spreadBtns) {
    btn.addEventListener('click', () => {
      spreadBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  const privacySwitch = document.getElementById('privacy-switch');
  if (privacySwitch) {
    const saved = getPrivacyMode();
    privacySwitch.setAttribute('aria-checked', saved === 'cloud' ? 'true' : 'false');
    privacySwitch.classList.toggle('active', saved === 'cloud');
    updateModeLabel(saved);

    privacySwitch.addEventListener('click', () => {
      const current = getPrivacyMode();
      const next = current === 'cloud' ? 'local' : 'cloud';
      setPrivacyMode(next);
      privacySwitch.setAttribute('aria-checked', next === 'cloud' ? 'true' : 'false');
      privacySwitch.classList.toggle('active', next === 'cloud');
      updateModeLabel(next);
    });
  }

  const spreadArea = document.getElementById('spread-area');
  if (spreadArea) {
    spreadArea.addEventListener('click', (e) => {
      const deepBtn = e.target.closest('.deep-dive-btn');
      if (deepBtn) {
        const cardEl = deepBtn.closest('.card');
        if (cardEl && cardEl._cardData) {
          renderDeepDive(cardEl._cardData);
          return;
        }
      }
    });
  }

  const overlay = document.getElementById('deep-dive-overlay');
  const closeBtn = document.getElementById('deep-dive-close');
  if (closeBtn) closeBtn.addEventListener('click', () => overlay?.classList.add('hidden'));
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
    }
  });
}

async function handleDraw() {
  const textarea = document.getElementById('user-question');
  const question = textarea?.value?.trim();
  if (!question) {
    showToast('请输入你的问题');
    return;
  }

  const activeBtn = document.querySelector('.spread-btn.active');
  const spreadType = activeBtn?.dataset?.spread || 'three';

  setDrawEnabled(false);
  currentQuestion = question;

  const cards = deck.cards || deck;

  try {
    let drawn;
    if (spreadType === 'single') {
      const daily = drawDaily(cards);
      drawn = daily ? [{ ...daily, position: 'daily', positionLabel: '今日' }] : [];
    } else {
      drawn = drawThree(cards, question);
    }

    if (drawn.length === 0) {
      renderEmptyState();
      return;
    }

    currentCards = drawn;
    const cardElements = renderCardSlots(drawn, spreadType);

    const flipDelay = prefersReducedMotion ? 0 : 300;
    for (let i = 0; i < cardElements.length; i++) {
      if (flipDelay > 0) await sleep(flipDelay);
      flipCard(cardElements[i], drawn[i]);
    }

    const privacyMode = getPrivacyMode();
    const result = await getInterpretation(question, drawn, privacyMode);
    renderInterpretation(result.interpretation, result.source);
  } catch (err) {
    console.error('[draw]', err);
    showToast('抽牌失败，请重试');
  } finally {
    setDrawEnabled(true);
  }
}

function renderCardSlots(cards, spreadType) {
  const spreadArea = document.getElementById('spread-area');
  const singleSpread = document.getElementById('spread-single');
  const threeSpread = document.getElementById('spread-three');
  if (!spreadArea) return [];

  spreadArea.classList.remove('hidden');
  if (singleSpread) singleSpread.classList.add('hidden');
  if (threeSpread) threeSpread.classList.add('hidden');

  const elements = [];

  if (spreadType === 'single' && singleSpread) {
    singleSpread.classList.remove('hidden');
    const slot = singleSpread.querySelector('.card-slot');
    if (slot) {
      slot.innerHTML = '';
      const el = renderCardBack(cards[0], 0, 'daily');
      slot.appendChild(el);
      elements.push(el);
    }
  } else if (threeSpread) {
    threeSpread.classList.remove('hidden');
    const columns = threeSpread.querySelectorAll('.card-column');
    columns.forEach((col, i) => {
      if (i >= cards.length) return;
      const slot = col.querySelector('.card-slot');
      if (slot) {
        slot.innerHTML = '';
        const el = renderCardBack(cards[i], i, cards[i].position);
        slot.appendChild(el);
        elements.push(el);
      }
    });
  }

  return elements;
}

function updateModeLabel(mode) {
  const label = document.getElementById('mode-label');
  if (label) label.textContent = mode === 'cloud' ? '云端模式' : '本地模式';
  const tooltip = document.getElementById('privacy-tooltip');
  if (tooltip) tooltip.classList.toggle('hidden', mode !== 'cloud');
}

function setDrawEnabled(enabled) {
  const btn = document.getElementById('draw-btn');
  if (btn) {
    btn.disabled = !enabled;
    btn.textContent = enabled ? '开始抽牌' : '抽牌中...';
  }
}

function showLoading(show) {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.toggle('hidden', !show);
}

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

function showError(msg) {
  const main = document.getElementById('spread-area') || document.querySelector('main');
  if (main) main.innerHTML = `<div class="error-state"><p>${msg}</p></div>`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function handleSave() {
  if (currentCards.length === 0) {
    showToast('请先抽牌再保存');
    return;
  }
  const reading = document.getElementById('reading-content');
  const interpretation = reading?.textContent || '';
  const lines = [`# 知识塔罗解读`, ``, `**问题**：${currentQuestion}`, ``, `---`, ``];
  for (const c of currentCards) {
    const label = c.positionLabel || c.position || '';
    lines.push(`**${label}**：${c.title}`);
    if (c.summary) lines.push(`> ${c.summary}`);
    if (c.scenario) lines.push(`适用：${c.scenario}`);
    lines.push(``);
  }
  if (interpretation) {
    lines.push(`---`, ``, `## 解读`, ``, interpretation);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tarot-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('解读已保存');
}

document.addEventListener('DOMContentLoaded', init);
