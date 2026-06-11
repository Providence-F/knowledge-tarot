const SUIT_LABELS = {
  'sword-of-self': '自我之剑',
  'mirror-of-world': '世界之镜',
  'compass-of-method': '方法之罗盘',
  'ship-of-action': '行动之舟',
  'seed-of-growth': '成长之种',
};

function escapeHtml(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

export function renderCardBack(card, index, position) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.cardId = card.id;
  el.dataset.position = position || '';

  const suitLabel = SUIT_LABELS[card.suit] || card.suit;

  el.innerHTML = `
    <div class="card-inner">
      <div class="card-back" style="background:#000;display:flex;align-items:center;justify-content:center;">
        <span style="color:#fff;font-size:1rem;letter-spacing:0.1em;">${escapeHtml(suitLabel)}</span>
      </div>
      <div class="card-front"></div>
    </div>
  `;

  el._cardData = card;
  el._index = index;

  // 直接绑定点击事件，避免事件委托失效
  el.addEventListener('click', (e) => {
    if (e.target.closest('.deep-dive-btn')) {
      renderDeepDive(el._cardData);
    }
  });

  return el;
}

export function flipCard(cardElement, cardData) {
  const card = cardData || cardElement._cardData;
  if (!card) return;

  const suitLabel = SUIT_LABELS[card.suit] || card.suit;
  const positionLabel = card.positionLabel || card.position || '';
  const front = cardElement.querySelector('.card-front');

  if (front) {
    const keyPointsHtml = (card.keyPoints && card.keyPoints.length > 0)
      ? `<div style="margin-bottom:0.6rem;">
          <div style="font-size:0.7rem;color:#888;margin-bottom:0.3rem;">关键要点</div>
          ${card.keyPoints.slice(0, 4).map(kp => `<div style="font-size:0.72rem;color:#555;margin-bottom:0.2rem;padding-left:0.8rem;position:relative;"><span style="position:absolute;left:0;">·</span>${escapeHtml(kp)}</div>`).join('')}
        </div>`
      : '';

    front.innerHTML = `
      <div style="padding:1.2rem;display:flex;flex-direction:column;height:100%;">
        <div style="font-size:0.75rem;color:#888;margin-bottom:0.3rem;">${escapeHtml(positionLabel)}</div>
        <div style="font-size:0.7rem;color:#aaa;margin-bottom:0.6rem;">${escapeHtml(suitLabel)}</div>
        <div style="font-size:1.1rem;font-weight:600;margin-bottom:0.5rem;">${escapeHtml(card.title)}</div>
        <div style="font-style:italic;font-size:0.82rem;margin-bottom:0.6rem;color:#444;">${escapeHtml(card.summary || '')}</div>
        ${keyPointsHtml}
        <div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.65rem;color:#bbb;">${card.arcana === 'major' ? '☀' : card.arcana === 'court' ? '☾' : '★'}</span>
          <button class="deep-dive-btn" style="font-size:0.7rem;padding:0.2rem 0.5rem;border:1px solid #ddd;border-radius:4px;background:transparent;cursor:pointer;">深度探索</button>
        </div>
      </div>
    `;

    // 直接在按钮上绑定 click，不依赖任何父级事件委托
    const btn = front.querySelector('.deep-dive-btn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderDeepDive(card);
      });
    }
  }

  cardElement.classList.add('flipped');
}

export function renderInterpretation(interpretation, source) {
  const section = document.getElementById('reading-area');
  const container = document.getElementById('reading-content');
  if (!section || !container) return;

  section.classList.remove('hidden');

  const indicator = document.getElementById('source-indicator');
  if (indicator) {
    const label = source === 'ai' ? '✨ AI 解读' : '📋 模板解读';
    indicator.textContent = label;
    indicator.setAttribute('data-source', source);
  }

  // 解析解读文本，按段落分组，增强排版
  const paragraphs = interpretation.split(/\n\n+/).filter(p => p.trim());
  let html = '';

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i].trim();
    const isLast = i === paragraphs.length - 1;

    // 最后一段通常是反思问题，用特殊样式
    if (isLast && paragraphs.length > 1) {
      html += `<blockquote style="margin:1.2rem 0;padding:0.8rem 1rem;border-left:3px solid #000;background:#f9f9f9;font-style:italic;color:#555;">${escapeHtml(p)}</blockquote>`;
    } else if (paragraphs.length > 1) {
      html += `<p style="margin-bottom:1rem;">${escapeHtml(p)}</p>`;
    } else {
      html += `<p>${escapeHtml(p)}</p>`;
    }
  }

  container.innerHTML = `<div class="reading-section">${html}</div>`;
}

export function renderDeepDive(cardData) {
  const overlay = document.getElementById('deep-dive-overlay');
  const content = document.getElementById('deep-dive-content');
  if (!overlay || !content) return;

  const suitLabel = SUIT_LABELS[cardData.suit] || cardData.suit;

  const keyPointsHtml = (cardData.keyPoints && cardData.keyPoints.length > 0)
    ? `<div style="margin-bottom:1rem;"><strong>关键要点：</strong><ul style="margin:0.5rem 0;padding-left:1.2rem;">
        ${cardData.keyPoints.map(kp => `<li style="margin-bottom:0.3rem;font-size:0.9rem;line-height:1.5;">${escapeHtml(kp)}</li>`).join('')}
      </ul></div>`
    : '';

  content.innerHTML = `
    <h2 style="font-size:1.4rem;font-weight:600;margin-bottom:0.5rem;">${escapeHtml(cardData.title)}</h2>
    <div style="font-size:0.8rem;color:#888;margin-bottom:1rem;">${escapeHtml(suitLabel)} · ${escapeHtml(cardData.sourceTitle || '')}</div>
    <div style="margin-bottom:1rem;"><strong>核心主张：</strong><em>${escapeHtml(cardData.summary || '')}</em></div>
    ${cardData.scenario ? `<div style="margin-bottom:1rem;color:#666;font-size:0.9rem;"><strong>适用场景：</strong>${escapeHtml(cardData.scenario)}</div>` : ''}
    ${keyPointsHtml}
    ${cardData.passage ? `<div style="border-top:1px solid #eee;padding-top:1rem;margin-top:1rem;line-height:1.8;font-size:0.9rem;color:#444;">${escapeHtml(cardData.passage)}</div>` : ''}
  `;

  overlay.classList.remove('hidden');
}

export function renderEmptyState(suitName) {
  const spreadArea = document.getElementById('spread-area');
  const emptyState = document.getElementById('empty-state');
  const emptyMessage = document.getElementById('empty-message');

  if (spreadArea) spreadArea.classList.add('hidden');
  if (emptyState) {
    emptyState.classList.remove('hidden');
    if (emptyMessage) {
      emptyMessage.textContent = suitName
        ? `「${suitName}」还没有牌可以抽取。去写一些笔记吧。`
        : '没有可用的牌。去写一些笔记吧。';
    }
  }
}
