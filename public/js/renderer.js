/**
 * renderer.js — 卡片渲染、翻转动画
 */

const Renderer = (function() {

  function getSuitClass(suitId) {
    return `suit-${suitId}`;
  }

  function getArcanaClass(arcana) {
    return `arcana-${arcana}`;
  }

  function getSuitIcon(suitId) {
    const icons = {
      'sword-of-self': '<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h1.64m-1.64 0v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H21M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"/></svg>',
      'mirror-of-world': '<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>',
      'compass-of-method': '<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/></svg>',
      'ship-of-action': '<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>',
      'seed-of-growth': '<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z"/></svg>'
    };
    return icons[suitId] || icons['sword-of-self'];
  }

  function renderCardContent(card) {
    // Prefer keyInsights over summary
    const insights = card.keyInsights || (card.summary ? [card.summary] : []);
    let html = '';

    if (insights.length > 0) {
      html += insights.slice(0, 2).map(insight =>
        `<p class="text-xs text-gray-600 leading-relaxed mb-2 flex items-start gap-1.5">
          <span class="text-gray-300 mt-0.5 flex-shrink-0">-</span>
          <span>${escapeHtml(insight)}</span>
        </p>`
      ).join('');
    }

    if (card.scenario) {
      html += `<div class="text-[11px] text-gray-500 border-t border-gray-200 pt-2 mt-2"><span class="text-black/60">适用：</span>${escapeHtml(card.scenario)}</div>`;
    }

    return html || `<p class="text-xs text-gray-400">暂无摘要</p>`;
  }

  function renderCard(card, index, options = {}) {
    const suitClass = getSuitClass(card.suit);
    const arcanaClass = getArcanaClass(card.arcana);
    const delay = options.delay || 0;
    const showPosition = !!card.positionName;

    const el = document.createElement('div');
    el.className = 'card-wrapper relative';
    el.style.animationDelay = `${delay}ms`;

    el.innerHTML = `
      <div class="card-inner" id="card-${index}">
        <!-- Back -->
        <div class="card-face card-back" data-index="${index}">
          <div class="card-back-pattern text-black/20">
            <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1">
              <circle cx="32" cy="32" r="28"/>
              <circle cx="32" cy="32" r="20"/>
              <circle cx="32" cy="32" r="12"/>
              <path d="M32 4v56M4 32h56"/>
            </svg>
          </div>
          <div class="mt-4 text-black/30 text-xs tracking-[0.3em] uppercase">Knowledge</div>
        </div>
        <!-- Front -->
        <div class="card-face card-front ${suitClass}">
          ${showPosition ? `<div class="position-label">${card.positionName}</div>` : ''}
          <div class="flex items-start justify-between mb-3">
            <span class="suit-badge px-2 py-0.5 rounded text-[10px] font-medium border">${card.suitName}</span>
            <span class="${arcanaClass} px-2 py-0.5 rounded text-[10px] font-medium uppercase">${card.arcana}</span>
          </div>
          <h3 class="card-title text-lg font-bold text-black mb-1 leading-snug" data-original-title="${escapeHtml(card.title)}">${escapeHtml(card.title)}</h3>
          <div class="text-[10px] text-tarot-muted mb-3">${card.typeLabel} · ${card.wordCount.toLocaleString()} 字</div>
          <div class="flex-1 overflow-hidden">
            ${renderCardContent(card)}
          </div>
          <button class="mt-3 w-full py-2 rounded-lg border border-gray-200 text-xs text-gray-500 hover:text-black hover:border-black/40 transition-colors detail-btn" data-index="${index}">
            深度探索
          </button>
        </div>
      </div>
    `;

    // Click back to flip (only if not already flipped)
    el.querySelector('.card-back').addEventListener('click', () => {
      if (!el.classList.contains('flipped')) {
        el.classList.add('flipped');
      }
    });

    // Detail button
    el.querySelector('.detail-btn').addEventListener('click', () => {
      showDetail(card, options.question || '');
    });

    return el;
  }

  function renderSpread(cards, containerId = 'cardsContainer', question = '') {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (cards.length === 0) {
      container.innerHTML = `
        <div class="empty-state w-full">
          <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
          <p>牌池为空，无法抽牌</p>
        </div>
      `;
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    cards.forEach((card, i) => {
      const cardEl = renderCard(card, i, { delay: i * 200, question });
      container.appendChild(cardEl);

      // Phase 1: dealing animation
      setTimeout(() => {
        cardEl.classList.add('dealing');
      }, i * 300);

      // Phase 2: auto-flip after dealing
      if (prefersReducedMotion) {
        // Skip animation, show immediately
        cardEl.classList.add('flipped');
      } else {
        const flipDelay = i * 300 + 600 + i * 500;
        setTimeout(() => {
          cardEl.classList.add('flipped');
        }, flipDelay);
      }
    });
  }

  function showDetail(card, question = '') {
    const modal = document.getElementById('detailModal');
    document.getElementById('modalTitle').textContent = card.title;
    document.getElementById('modalPath').textContent = card.path;
    document.getElementById('modalDate').textContent = card.mtime ? new Date(card.mtime).toLocaleDateString('zh-CN') : '';

    const suitBadge = document.getElementById('modalSuitBadge');
    suitBadge.textContent = card.suitName;
    suitBadge.className = `suit-badge px-2 py-0.5 rounded text-xs border ${getSuitClass(card.suit)}`;

    const typeBadge = document.getElementById('modalTypeBadge');
    typeBadge.textContent = card.typeLabel;

    // Render content
    const content = document.getElementById('modalContent');

    if (card.structuredSections && card.structuredSections.length > 0) {
      // Use structured sections
      let html = '';
      card.structuredSections.forEach(section => {
        switch (section.type) {
          case 'claim':
            html += `<div class="bg-gray-50 rounded-lg p-4 mb-4">
              <div class="text-xs text-gray-400 mb-1">核心主张</div>
              <p class="text-sm font-medium text-black">${escapeHtml(section.text)}</p>
            </div>`;
            break;
          case 'insight':
            html += `<div class="mb-4">
              <div class="text-xs text-gray-400 mb-2">深度内容</div>
              <div class="text-sm text-gray-700 leading-relaxed">${formatMarkdown(section.text)}</div>
            </div>`;
            break;
          case 'scenario':
            html += `<div class="border-t border-gray-100 pt-3 mt-3">
              <div class="text-xs text-gray-400 mb-1">适用场景</div>
              <p class="text-sm text-gray-600">${escapeHtml(section.text)}</p>
            </div>`;
            break;
        }
      });
      content.innerHTML = html || '<p class="text-gray-400">暂无详细内容</p>';
    } else {
      // Fallback to passage
      content.innerHTML = formatPassage(card.passage);
    }

    // AI deep explore
    const aiExploreDiv = document.getElementById('modalAiExplore');
    aiExploreDiv.classList.remove('hidden');
    aiExploreDiv.innerHTML = '<div class="text-center py-4 text-gray-400 text-sm">正在深度探索...</div>';

    fetch('/api/deep-explore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question || null,
        card: {
          title: card.title,
          suitName: card.suitName,
          typeLabel: card.typeLabel,
          summary: card.summary,
          passage: card.passage
        }
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.content) {
        renderAIDeepExplore(aiExploreDiv, data.content);
      } else {
        aiExploreDiv.classList.add('hidden');
      }
    })
    .catch(() => aiExploreDiv.classList.add('hidden'));

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // 重置内层滚动容器位置，避免复用 modal 时残留上一次的 scrollTop
    const scrollContainer = modal.querySelector('.overflow-y-auto');
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }

  function formatPassage(passage) {
    if (!passage) return '<p class="text-gray-400">暂无详细内容</p>';
    const lines = passage.split('\n').filter(l => l.trim());
    let html = '';
    lines.forEach(line => {
      let trimmed = line.trim();
      if (!trimmed) return;
      // 处理标题
      if (trimmed.startsWith('#')) {
        const level = Math.min(trimmed.match(/^#+/)[0].length, 3);
        const text = trimmed.replace(/^#+\s*/, '');
        html += `<h${level + 1} class="text-black font-bold mt-4 mb-2">${escapeHtml(text)}</h${level + 1}>`;
      } else if (trimmed.startsWith('>')) {
        html += `<blockquote class="border-l-2 border-gray-300 pl-3 text-gray-600 italic">${escapeHtml(trimmed.replace(/^>\s*/, ''))}</blockquote>`;
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        html += `<li class="ml-4 text-gray-700">${escapeHtml(trimmed.replace(/^[-*]\s*/, ''))}</li>`;
      } else if (/^\d+\.\s/.test(trimmed)) {
        html += `<li class="ml-4 text-gray-700">${escapeHtml(trimmed.replace(/^\d+\.\s*/, ''))}</li>`;
      } else {
        // 处理行内粗体和斜体
        trimmed = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        trimmed = trimmed.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html += `<p class="text-gray-700">${trimmed}</p>`;
      }
    });
    return html || '<p class="text-gray-400">暂无详细内容</p>';
  }

  function formatMarkdown(text) {
    if (!text) return '';
    return text.split('\n').map(line => {
      let trimmed = line.trim();
      if (!trimmed) return '';
      // 处理标题
      if (trimmed.startsWith('#')) {
        const level = Math.min(trimmed.match(/^#+/)[0].length, 3);
        const text = trimmed.replace(/^#+\s*/, '');
        return `<h${level + 1} class="font-bold mt-3 mb-1">${escapeHtml(text)}</h${level + 1}>`;
      }
      // 处理列表
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return `<li class="ml-4 text-gray-700">${escapeHtml(trimmed.replace(/^[-*]\s*/, ''))}</li>`;
      }
      // 处理行内粗体和斜体
      trimmed = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      trimmed = trimmed.replace(/\*(.+?)\*/g, '<em>$1</em>');
      return `<p class="text-gray-700">${trimmed}</p>`;
    }).filter(Boolean).join('');
  }

  function renderAIDeepExplore(container, content) {
    let html = '<div class="border-t border-gray-200 pt-4 mt-4">';
    html += '<div class="text-xs text-gray-400 mb-2 flex items-center gap-1">';
    html += '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';
    html += 'AI 深度解读</div>';

    if (content.essence) {
      html += `<p class="text-sm font-medium text-black mb-3 italic">"${escapeHtml(content.essence)}"</p>`;
    }
    if (content.relevance) {
      html += `<div class="text-sm text-gray-700 leading-relaxed mb-3">${escapeHtml(content.relevance)}</div>`;
    }
    if (content.quote) {
      html += `<blockquote class="border-l-2 border-gray-300 pl-3 text-xs text-gray-500 italic">${escapeHtml(content.quote)}</blockquote>`;
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function hideDetail() {
    document.getElementById('detailModal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Event bindings
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('detailOverlay')?.addEventListener('click', hideDetail);
    document.getElementById('modalClose')?.addEventListener('click', hideDetail);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideDetail();
    });
  });

  return {
    renderCard,
    renderSpread,
    showDetail,
    hideDetail,
    escapeHtml
  };
})();
