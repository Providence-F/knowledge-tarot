/**
 * v2-import.js — 独立导入页（粘贴 + 文件上传）
 * 完成后跳回 v2.html 抽牌
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    refreshDeckHint();

    $('pasteBtn').addEventListener('click', handlePaste);
    $('fileInput').addEventListener('change', handleFileSelect);
    $('uploadBtn').addEventListener('click', handleUpload);
    bindDropZone();
  }

  async function refreshDeckHint() {
    try {
      const r = await fetch('/api/v2/me');
      const data = await r.json();
      if (data.deckSize > 0) {
        $('deckSizeHint').textContent = `当前牌堆：${data.deckSize} 张牌`;
      } else {
        $('deckSizeHint').textContent = '当前牌堆：空';
      }
    } catch {}
  }

  // ── 粘贴 ────────────────────────────────────────────
  async function handlePaste() {
    const text = $('pasteInput').value.trim();
    if (text.length < 30) {
      showStatus('至少 30 字才能成为牌', 'warn');
      return;
    }
    showStatus('正在切片、分诊、提炼、贴花色...（每段约 1-3 秒）', 'info');
    $('pasteBtn').disabled = true;
    try {
      const r = await fetch('/api/v2/import/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          label: '粘贴-' + new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '导入失败');
      showStatus(`✓ 新增 ${data.added} 张牌（牌堆共 ${data.total} 张）— 已可前往抽牌`, 'success');
      $('pasteInput').value = '';
      refreshDeckHint();
    } catch (e) {
      showStatus('✗ ' + e.message, 'error');
    } finally {
      $('pasteBtn').disabled = false;
    }
  }

  // ── 上传 ────────────────────────────────────────────
  let selectedFiles = [];

  function handleFileSelect(e) {
    selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) {
      $('fileList').textContent = '';
      $('uploadBtn').classList.add('hidden');
      return;
    }
    const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);
    $('fileList').innerHTML = `已选 ${selectedFiles.length} 个文件（${(totalSize/1024/1024).toFixed(1)} MB）：<br>${selectedFiles.map(f => '· ' + f.name).join('<br>')}`;
    $('uploadBtn').classList.remove('hidden');
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) return;
    const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);
    const estMin = Math.max(1, Math.round(totalSize / 1024 / 1024 * 0.7));
    showStatus(`正在处理 ${selectedFiles.length} 个文件...大约需要 ${estMin} 分钟，请保持页面打开`, 'info');
    $('uploadBtn').disabled = true;
    const fd = new FormData();
    selectedFiles.forEach(f => fd.append('files', f));
    try {
      const r = await fetch('/api/v2/import/files', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '上传失败');
      const dropped = (data.stats?.droppedByCategory?.data || 0) + (data.stats?.droppedByCategory?.code || 0) + (data.stats?.droppedByCategory?.other || 0);
      let msg = `✓ 新增 ${data.added} 张牌（牌堆共 ${data.total} 张）`;
      if (dropped > 0) msg += `，过滤 ${dropped} 条无价值内容`;
      showStatus(msg, 'success');
      selectedFiles = [];
      $('fileInput').value = '';
      $('fileList').textContent = '';
      $('uploadBtn').classList.add('hidden');
      refreshDeckHint();
    } catch (e) {
      showStatus('✗ ' + e.message, 'error');
    } finally {
      $('uploadBtn').disabled = false;
    }
  }

  function bindDropZone() {
    const dropZone = $('dropZone');
    if (!dropZone) return;

    ['dragenter', 'dragover'].forEach(ev => {
      dropZone.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.add('border-black/60', 'bg-tarot-accent');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dropZone.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.remove('border-black/60', 'bg-tarot-accent');
      });
    });
    dropZone.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      $('fileInput').files = dt.files;
      handleFileSelect({ target: $('fileInput') });
    });

    // 防止误拖到页面其他位置打开文件
    ['dragover', 'drop'].forEach(ev => {
      window.addEventListener(ev, e => {
        if (!dropZone.contains(e.target)) e.preventDefault();
      });
    });
  }

  // ── status ───────────────────────────────────────────
  function showStatus(msg, type) {
    const el = $('importStatus');
    el.classList.remove('hidden', 'bg-tarot-accent', 'border-tarot-border', 'text-tarot-ivory',
      'bg-amber-50', 'border-amber-200', 'text-amber-800',
      'bg-red-50', 'border-red-200', 'text-red-800',
      'bg-green-50', 'border-green-200', 'text-green-800');
    const cls = {
      info: ['bg-tarot-accent', 'border-tarot-border', 'text-tarot-ivory'],
      warn: ['bg-amber-50', 'border-amber-200', 'text-amber-800'],
      error: ['bg-red-50', 'border-red-200', 'text-red-800'],
      success: ['bg-green-50', 'border-green-200', 'text-green-800']
    }[type] || ['bg-tarot-accent', 'border-tarot-border', 'text-tarot-ivory'];
    el.classList.add(...cls);
    el.textContent = msg;
  }

})();
