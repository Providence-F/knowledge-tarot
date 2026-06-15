/**
 * app.js — 主逻辑
 */

(function() {
  let currentSpread = 'single';
  let currentCards = [];
  let currentQuestion = '';

  // ── Init ────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', async () => {
    // Load deck
    try {
      await Deck.load();
    } catch (err) {
      console.error('Failed to load deck:', err);
      alert('牌组加载失败，请检查 data/cards.json');
      return;
    }

    // Load history
    renderHistory();

    // Bind events
    bindEvents();
  });

  // ── Events ──────────────────────────────────────────────

  function bindEvents() {
    // Spread selection
    document.querySelectorAll('.spread-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.spread-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSpread = btn.dataset.spread;
      });
    });

    // Draw
    document.getElementById('drawBtn').addEventListener('click', handleDraw);

    // Redraw
    document.getElementById('redrawBtn').addEventListener('click', handleDraw);

    // Export
    document.getElementById('exportBtn').addEventListener('click', exportMarkdown);

    // Stats
    document.getElementById('statsBtn').addEventListener('click', showStats);
    document.getElementById('statsOverlay').addEventListener('click', hideStats);
    document.getElementById('statsClose').addEventListener('click', hideStats);

    // Char count
    document.getElementById('questionInput').addEventListener('input', (e) => {
      document.getElementById('charCount').textContent = `${e.target.value.length}/200`;
    });

    // Enter to draw
    document.getElementById('questionInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleDraw();
    });
  }

  // ── Draw ────────────────────────────────────────────────

  async function handleDraw() {
    const input = document.getElementById('questionInput');
    currentQuestion = input.value.trim() || null;

    // Reset
    document.getElementById('spreadArea').classList.remove('hidden');
    document.getElementById('actionsSection').classList.remove('hidden');
    document.getElementById('aiSection').classList.add('hidden');
    document.getElementById('aiContent').innerHTML = '';

    // Draw cards
    if (currentSpread === 'single') {
      currentCards = Deck.drawSingle(currentQuestion);
    } else {
      currentCards = Deck.drawThree(currentQuestion);
    }

    Renderer.renderSpread(currentCards, 'cardsContainer', currentQuestion);

    // 立即设置占位标题（避免显示文件名）
    const placeholderTitles = currentCards.map(() => '正在解读...');
    AI.replaceCardTitles(placeholderTitles);

    // Save to history
    saveReading();
    renderHistory();

    // Wait for flip animation to complete before showing AI interpretation
    const flipDuration = currentCards.length * 800 + 600;
    await new Promise(resolve => setTimeout(resolve, flipDuration));

    // AI interpretation
    if (currentCards.length > 0) {
      AI.showLoading();
      const data = await AI.requestInterpretation(currentQuestion, currentCards);
      AI.renderInterpretation(data);
    }
  }

  // ── History ─────────────────────────────────────────────

  function saveReading() {
    const readings = getHistory();
    readings.unshift({
      id: Date.now().toString(),
      question: currentQuestion,
      spread: currentSpread,
      cards: currentCards.map(c => ({ id: c.id, title: c.title, positionName: c.positionName })),
      timestamp: Date.now()
    });
    // Keep last 50
    if (readings.length > 50) readings.pop();
    localStorage.setItem('tarot_readings', JSON.stringify(readings));
  }

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem('tarot_readings') || '[]');
    } catch {
      return [];
    }
  }

  function renderHistory() {
    const readings = getHistory();
    const section = document.getElementById('historySection');
    const list = document.getElementById('historyList');

    if (readings.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    list.innerHTML = readings.slice(0, 10).map(r => {
      const date = new Date(r.timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const cardTitles = r.cards.map(c => c.title).join('、');
      return `
        <div class="p-3 rounded-xl border border-tarot-border/60 bg-tarot-card/30 text-sm">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-tarot-muted text-xs">${date}</span>
            <span class="text-black/60 text-xs">${r.spread === 'single' ? '日签' : '三牌阵'}</span>
          </div>
          <div class="font-medium text-gray-800 mb-1">${Renderer.escapeHtml(r.question)}</div>
          <div class="text-xs text-tarot-muted truncate">${Renderer.escapeHtml(cardTitles)}</div>
        </div>
      `;
    }).join('');
  }

  // ── Export ──────────────────────────────────────────────

  function exportMarkdown() {
    if (currentCards.length === 0) return;

    const date = new Date().toLocaleDateString('zh-CN');
    let md = `# Knowledge Tarot 解读 — ${date}\n\n`;
    md += `**问题**：${currentQuestion || '今日指引'}\n\n`;
    md += `**牌阵**：${currentSpread === 'single' ? '日签' : '三牌阵'}\n\n`;
    md += `---\n\n`;

    currentCards.forEach(c => {
      md += `## ${c.positionName ? `【${c.positionName}】` : ''}${c.title}\n\n`;
      md += `- 花色：${c.suitName}\n`;
      md += `- 牌型：${c.typeLabel}\n`;
      md += `- 牌位：${c.arcana}\n\n`;
      md += `> ${c.summary}\n\n`;
      if (c.scenario) {
        md += `**适用场景**：${c.scenario}\n\n`;
      }
      md += `---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tarot-reading-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Stats ───────────────────────────────────────────────

  function showStats() {
    const stats = Deck.getStats();
    const content = document.getElementById('statsContent');

    let html = `
      <div class="flex justify-between items-center py-2 border-b border-tarot-border/50">
        <span class="text-tarot-muted">总卡牌数</span>
        <span class="font-bold text-black">${stats.total}</span>
      </div>
      <div class="mt-3">
        <div class="text-xs text-tarot-muted mb-2">花色分布</div>
        ${Object.entries(stats.suits).map(([name, count]) => {
          const pct = ((count / stats.total) * 100).toFixed(1);
          return `<div class="flex justify-between text-sm py-1"><span>${name}</span><span>${count} (${pct}%)</span></div>`;
        }).join('')}
      </div>
      <div class="mt-3">
        <div class="text-xs text-tarot-muted mb-2">牌位分布</div>
        ${Object.entries(stats.arcanas).map(([name, count]) => {
          const label = name === 'major' ? '大牌 (Major)' : name === 'court' ? '宫廷 (Court)' : '小牌 (Pip)';
          return `<div class="flex justify-between text-sm py-1"><span>${label}</span><span>${count}</span></div>`;
        }).join('')}
      </div>
    `;

    content.innerHTML = html;
    document.getElementById('statsModal').classList.remove('hidden');
  }

  function hideStats() {
    document.getElementById('statsModal').classList.add('hidden');
  }

})();
