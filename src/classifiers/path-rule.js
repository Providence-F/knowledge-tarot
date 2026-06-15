/**
 * src/classifiers/path-rule.js — 旧 Obsidian 路径规则花色分类
 * 看 sourceMeta.path 顶层目录，命中 suit-mapping.json 的 directories 列表即贴花色
 * 没命中返回 null（M0 阶段表示"丢弃"，行为对齐旧版）
 */

const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'config', 'suit-mapping.json'),
  'utf-8'
));

function classify(rawItem) {
  const p = rawItem.sourceMeta?.path;
  if (!p) return null;
  const topDir = p.split(/[\\/]/)[0];
  for (const suit of config.suits) {
    if (suit.directories.includes(topDir)) {
      return { suitId: suit.id, suitName: suit.name, confidence: 1.0 };
    }
  }
  return null;
}

function detectCardType(filename) {
  for (const tp of config.cardTypes) {
    if (new RegExp(tp.pattern).test(filename)) {
      return { type: tp.type, label: tp.label };
    }
  }
  return { type: 'note', label: '笔记牌' };
}

function getArcana(status) {
  if (!status) return config.defaultArcana;
  return config.arcanaMap[status] || config.defaultArcana;
}

module.exports = { classify, detectCardType, getArcana };
