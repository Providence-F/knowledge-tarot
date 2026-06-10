// renderer.js — Rendering module (ES module)

const SUIT_ICONS = {
  'sword-of-self': '&#9876;',
  'mirror-of-world': '&#128090;',
  'compass-of-method': '&#9788;',
  'ship-of-action': '&#9973;',
  'seed-of-growth': '&#127793;',
};

const SUIT_LABELS = {
  'sword-of-self': '自我之剑',
  'mirror-of-world': '世界之镜',
  'compass-of-method': '方法之罗盘',
  'ship-of-action': '行动之舟',
  'seed-of-growth': '成长之种',
};

const ARCANA_SYMBOLS = {
  major: '☀',
  court: '☾',
  pip: '★',
};

/**
 * Create a card DOM element matching the CSS structure.
 */
export function renderCard(card, faceDown = true) {
  const el = document.createElement('div');
  el.className = 'card' + (faceDown ? '' : ' flipped');
  el.dataset.cardId = card.id;

  const icon = SUIT_ICONS[card.suit] || '?';
  const arcana = ARCANA_SYMBOLS[card.arcana] || '★';
  const suitLabel = SUIT_LABELS[card.suit] || card.suit;

  el.innerHTML = `
    <div class="card-inner">
      <div class="card-back">
        <svg viewBox="0 0 220 320" width="80%" height="80%">
          <rect x="8" y="8" width="204" height="304" rx="7" ry="7" fill="none" stroke="#fff" stroke-width="1" opacity="0.3"/>
          <g transform="translate(110, 155)" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.5">
            <path d="M-4,-20 Q-30,-16 -35,0 L-35,30 Q-30,28 -4,24 Z"/>
            <path d="M4,-20 Q30,-16 35,0 L35,30 Q30,28 4,24 Z"/>
            <line x1="0" y1="-22" x2="0" y2="24"/>
            <g transform="translate(0, -38)">
              <path d="M-18,0 Q0,-14 18,0 Q0,14 -18,0 Z"/>
              <circle cx="0" cy="0" r="5"/>
              <circle cx="0" cy="0" r="2" fill="#fff"/>
            </g>
          </g>
        </svg>
      </div>
      <div class="card-front">
        <div class="card-front-header">
          <span class="card-type-icon">${icon}</span>
          <span class="card-arcana">${arcana}</span>
        </div>
        <div class="card-front-body">
          <div class="card-title">${escapeHtml(card.title)}</div>
          <div class="card-hook">${escapeHtml(card.hook || card.summary || '')}</div>
        </div>
        <div class="card-suit-label">${escapeHtml(suitLabel)}</div>
      </div>
    </div>
  `;

  el._cardData = card;
  return el;
}

/**
 * Render the spread layout using existing HTML card-slot elements.
 */
export function renderSpread(cards, spreadType) {
  const spreadArea = document.getElementById('spread-area');
  const singleSpread = document.getElementById('spread-single');
  const threeSpread = document.getElementById('spread-three');
  if (!spreadArea) return [];

  spreadArea.classList.remove('hidden');
  if (singleSpread) singleSpread.classList.add('hidden');
  if (threeSpread) threeSpread.classList.add('hidden');

  const cardElements = [];

  if (spreadType === 'single' && singleSpread) {
    singleSpread.classList.remove('hidden');
    const slot = singleSpread.querySelector('.card-slot');
    if (slot) {
      slot.innerHTML = '';
      const cardEl = renderCard(cards[0], true);
      cardEl.classList.add('card-enter');
      slot.appendChild(cardEl);
      cardElements.push(cardEl);
    }
  } else if (threeSpread) {
    threeSpread.classList.remove('hidden');
    const columns = threeSpread.querySelectorAll('.card-column');

    columns.forEach((col, i) => {
      if (i >= cards.length) return;
      const slot = col.querySelector('.card-slot');
      if (slot) {
        slot.innerHTML = '';
        const cardEl = renderCard(cards[i], true);
        cardEl.style.animationDelay = `${i * 200}ms`;
        cardEl.classList.add('card-enter');
        slot.appendChild(cardEl);
        cardElements.push(cardEl);
      }
    });
  }

  return cardElements;
}

/**
 * Flip a single card by adding the 'flipped' class.
 */
export function flipCard(cardElement) {
  cardElement.classList.add('flipped');
}

/**
 * Flip cards one by one with delay.
 */
export function flipAllCardsSequentially(cardElements, delay = 600) {
  return new Promise(resolve => {
    if (cardElements.length === 0) { resolve(); return; }
    cardElements.forEach((el, i) => {
      setTimeout(() => {
        flipCard(el);
        if (i === cardElements.length - 1) {
          setTimeout(resolve, 800); // wait for CSS transition
        }
      }, i * delay);
    });
  });
}

/**
 * Show the AI reading.
 */
export function renderReading(interpretation, source) {
  const section = document.getElementById('reading-area');
  const container = document.getElementById('reading-content');
  if (!section || !container) return;

  section.classList.remove('hidden');

  const parsed = parseXmlInterpretation(interpretation);

  const sourceIcon = source === 'ai' ? '✨' : '📋';
  const sourceLabel = source === 'ai' ? 'AI 解读' : '模板解读';

  const indicator = document.getElementById('source-indicator');
  if (indicator) {
    indicator.textContent = `${sourceIcon} ${sourceLabel}`;
    indicator.setAttribute('data-source', source);
  }

  let html = '';

  if (parsed.reflection) {
    html += `
      <div class="reading-section reading-reflection">
        <h3 class="font-cinzel tracking-wide mb-2 font-semibold">映照</h3>
        <p>${escapeHtml(parsed.reflection)}</p>
      </div>`;
  }

  if (parsed.connection) {
    html += `
      <div class="reading-section reading-connection mt-6">
        <h3 class="font-cinzel tracking-wide mb-2 font-semibold">联结</h3>
        <p>${escapeHtml(parsed.connection)}</p>
      </div>`;
  }

  if (parsed.question) {
    html += `
      <div class="reading-section reading-question mt-6">
        <h3 class="font-cinzel tracking-wide mb-2 font-semibold">反思</h3>
        <p class="italic">${escapeHtml(parsed.question)}</p>
      </div>`;
  }

  if (!parsed.reflection && !parsed.connection && !parsed.question) {
    html += `<div class="reading-section"><p>${escapeHtml(interpretation)}</p></div>`;
  }

  container.innerHTML = html;
}

/**
 * Parse XML tags from Claude response.
 */
function parseXmlInterpretation(text) {
  if (!text) return { reflection: '', connection: '', question: '' };
  const extract = (tag) => {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : '';
  };
  return {
    reflection: extract('reflection'),
    connection: extract('connection'),
    question: extract('question'),
  };
}

/**
 * Show full passage content in the modal.
 */
export function renderDeepDive(card) {
  const overlay = document.getElementById('deep-dive-overlay');
  const content = document.getElementById('deep-dive-content');
  if (!overlay || !content) return;

  const suitLabel = SUIT_LABELS[card.suit] || card.suit;
  const arcana = ARCANA_SYMBOLS[card.arcana] || '';

  content.innerHTML = `
    <div class="mb-6">
      <span class="text-2xl mr-2">${arcana}</span>
      <h2 class="font-cinzel text-2xl inline font-semibold">${escapeHtml(card.title)}</h2>
      <span class="ml-3 text-muted text-sm">${escapeHtml(suitLabel)}</span>
    </div>
    <div class="space-y-4">
      <div>
        <strong>核心主张：</strong>${escapeHtml(card.hook || card.summary || '')}
      </div>
      ${card.scenario ? `<div><strong>适用场景：</strong>${escapeHtml(card.scenario)}</div>` : ''}
      ${card.passage ? `<div class="mt-6 pt-4 border-t border-border"><p class="leading-relaxed">${escapeHtml(card.passage)}</p></div>` : ''}
    </div>
  `;

  overlay.classList.remove('hidden');
}

/**
 * Show friendly message when a suit has no cards.
 */
export function showEmptyState(suitLabel) {
  const spreadArea = document.getElementById('spread-area');
  const emptyState = document.getElementById('empty-state');
  const emptyMessage = document.getElementById('empty-message');

  if (spreadArea) spreadArea.classList.add('hidden');
  if (emptyState) {
    emptyState.classList.remove('hidden');
    if (emptyMessage) {
      emptyMessage.textContent = `「${suitLabel}」还没有牌可以抽取。去写一些笔记吧。`;
    }
  }
}

/**
 * Generate markdown export of the reading.
 */
export function exportReading(question, cards, interpretation) {
  const today = new Date().toISOString().split('T')[0];
  const parsed = parseXmlInterpretation(interpretation);

  let md = `# 知识塔罗解读\n`;
  md += `**日期**: ${today}\n`;
  md += `**问题**: ${question}\n\n`;

  md += `## 抽到的牌\n\n`;
  for (const card of cards) {
    md += `### ${card.position}：${card.title}\n`;
    md += `> ${card.summary || card.hook || ''}\n\n`;
  }

  md += `## 解读\n\n`;
  if (parsed.reflection) md += `### 映照\n${parsed.reflection}\n\n`;
  if (parsed.connection) md += `### 联结\n${parsed.connection}\n\n`;
  if (parsed.question) md += `### 反思\n${parsed.question}\n\n`;

  if (!parsed.reflection && !parsed.connection && !parsed.question) {
    md += interpretation + '\n\n';
  }

  return md;
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
