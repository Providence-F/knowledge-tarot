/**
 * ai.js — AI 解读调用（含降级）
 * 后端已切换为 JSON 结构化输出：data.body 是对象，data.card_titles 是数组
 */

const AI = (function() {

  async function requestInterpretation(question, cards) {
    const payload = {
      question,
      cards: cards.map(c => ({
        position: c.position,
        positionName: c.positionName,
        title: c.title,
        summary: c.summary,
        scenario: c.scenario,
        suitName: c.suitName,
        typeLabel: c.typeLabel,
        passage: c.passage || ''
      }))
    };

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);

    try {
      const res = await fetch('/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      clearTimeout(timeout);

      const data = await res.json().catch(() => ({}));

      if (!res.ok && res.status !== 503) {
        throw new Error(`HTTP ${res.status}`);
      }

      return {
        source: data.source || 'ai',
        body: data.body || {},
        warning: data.warning || null,
        card_titles: data.card_titles || []
      };
    } catch (err) {
      clearTimeout(timeout);
      // 前端兜底：直接用知识库的原始内容拼一个 body
      const isThreeCard = cards.length === 3;
      if (isThreeCard) {
        return {
          source: 'fallback',
          body: {
            card_titles: cards.map(c => c.title),
            past: cards[0]?.summary || '',
            present: cards[1]?.summary || '',
            future: cards[2]?.summary || '',
            narrative: '（未连接 AI，以下为知识库原文摘要）',
            question: ''
          },
          card_titles: cards.map(c => c.title),
          warning: 'AI 服务暂时不可用，以下是基于牌面信息的直接展示。'
        };
      }
      const c = cards[0] || {};
      return {
        source: 'fallback',
        body: {
          card_title: c.title || '',
          reflection: c.summary || '',
          connection: c.scenario || '',
          question: ''
        },
        card_titles: c.title ? [c.title] : [],
        warning: 'AI 服务暂时不可用，以下是基于牌面信息的直接展示。'
      };
    }
  }

  function renderInterpretation(data) {
    const section = document.getElementById('aiSection');
    const content = document.getElementById('aiContent');
    const source = document.getElementById('aiSource');
    const loading = document.getElementById('aiLoading');

    section.classList.remove('hidden');
    loading.classList.add('hidden');

    if (data.warning) {
      source.innerHTML = `<span class="text-amber-500/80">⚠ ${data.warning}</span>`;
    } else {
      source.textContent = data.source === 'ai' ? 'AI 解读' : '本地模式';
    }

    const body = data.body || {};
    const isThreeCard = Array.isArray(body.card_titles) || body.past || body.present || body.future;
    let html = '';

    if (isThreeCard) {
      const positions = [
        { key: 'past', label: '过去', icon: '◁' },
        { key: 'present', label: '现在', icon: '◆' },
        { key: 'future', label: '未来', icon: '▷' }
      ];

      html += '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">';
      positions.forEach(pos => {
        if (body[pos.key]) {
          html += `<div class="text-center p-3 rounded-lg bg-gray-50">
            <div class="text-xs text-gray-400 mb-2">${pos.icon} ${pos.label}</div>
            <p class="text-sm text-gray-700 leading-relaxed">${Renderer.escapeHtml(body[pos.key])}</p>
          </div>`;
        }
      });
      html += '</div>';

      if (body.narrative) {
        html += `<div class="border-t border-gray-200 pt-4 mt-2">
          <div class="text-black text-xs font-bold mb-2 uppercase tracking-wider">叙事弧线</div>
          <p class="text-sm leading-relaxed text-gray-700">${Renderer.escapeHtml(body.narrative)}</p>
        </div>`;
      }
    } else {
      if (body.reflection) {
        html += `<div><div class="text-black text-xs font-bold mb-1 uppercase tracking-wider">映照</div><p>${Renderer.escapeHtml(body.reflection)}</p></div>`;
      }
      if (body.connection) {
        html += `<div><div class="text-black text-xs font-bold mb-1 uppercase tracking-wider">联结</div><p>${Renderer.escapeHtml(body.connection)}</p></div>`;
      }
    }

    if (body.question) {
      html += `<div class="pt-3 border-t border-gray-200 mt-3"><div class="text-black text-xs font-bold mb-1 uppercase tracking-wider">问题</div><p class="text-gray-700 italic">${Renderer.escapeHtml(body.question)}</p></div>`;
    }

    if (!html && body._raw) {
      html = `<p>${Renderer.escapeHtml(body._raw)}</p>`;
    }

    content.innerHTML = html || '<p class="text-gray-400 text-sm">解读为空</p>';

    replaceCardTitles(data.card_titles || []);
  }

  function replaceCardTitles(aiTitles) {
    const cardElements = document.querySelectorAll('.card-wrapper');
    // 中性兜底词：明确表示"AI 没给出标题"，而不是伪装成有内容的结论
    const defaultTitles = ['待解', '无题', '空白', '在沉默处', '—'];

    cardElements.forEach((cardEl, index) => {
      const titleEl = cardEl.querySelector('.card-title');
      if (!titleEl) return;

      // 保存原始标题（笔记原文件名），用于 hover tooltip
      const currentText = titleEl.textContent;
      if (!titleEl.getAttribute('data-original-title')) {
        titleEl.setAttribute('data-original-title', currentText);
      }
      titleEl.setAttribute('title', `原文：${titleEl.getAttribute('data-original-title')}`);

      if (aiTitles[index]) {
        titleEl.textContent = aiTitles[index];
      } else {
        titleEl.textContent = defaultTitles[index % defaultTitles.length];
      }
    });
  }

  function showLoading() {
    document.getElementById('aiSection').classList.remove('hidden');
    document.getElementById('aiLoading').classList.remove('hidden');
    document.getElementById('aiContent').innerHTML = '';
  }

  return {
    requestInterpretation,
    renderInterpretation,
    showLoading,
    replaceCardTitles
  };
})();
