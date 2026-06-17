/**
 * server/index.js — Express 服务器 + AI 解读 API
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

const express = require('express');
const path = require('path');
const fs = require('fs');

// 启动时 seed：HF Spaces 持久卷会盖住容器内的 data/，需要把镜像里的 public-deck.json 拷过去
require('./seed-public-deck')();

const app = express();
const PORT = process.env.PORT || 7860;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/', (req, res) => {
  res.redirect(302, '/v2.html');
});

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/data', express.static(path.join(__dirname, '..', 'data')));

// ── v2 路由（多源接入 + 用户系统） ────────────────────────
const v2Routes = require('./v2-routes');
app.use('/api/v2', v2Routes);

// ── Health ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Share landing ────────────────────────────────────────
app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'v2-share-receive.html'));
});

// ── SPA fallback ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Knowledge Tarot server running at http://localhost:${PORT}`);
  console.log(`Privacy mode: ${DEEPSEEK_API_KEY ? 'Cloud available' : 'Local only (no API key)'}`);
});
