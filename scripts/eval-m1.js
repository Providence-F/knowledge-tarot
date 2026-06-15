/**
 * scripts/eval-m1.js — M1 提炼质量评估脚本
 *
 * 从 Kai 的 Obsidian vault 里抽 30 条混合样本：
 * - 10 条来自 07-日志（高概率反思类）
 * - 10 条来自 03-方法论（高概率观点/分析类）
 * - 10 条随机
 *
 * 跑 triager + extractor，把结果以人眼可读的形式打出来。
 * 用户根据"分诊准确率"和"提炼质量"打分。
 */

const path = require('path');
const fs = require('fs');
const obsidian = require('../src/adapters/obsidian');
const { triage } = require('../src/triager');
const { extractByType } = require('../src/extractors');

const config = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'config', 'suit-mapping.json'), 'utf-8'
));

async function main() {
  const items = obsidian.loadFromVault(config.knowledgeBasePath);
  console.log(`Loaded ${items.length} raw items from vault\n`);

  // 分组采样
  const fromLogs = items.filter(i => i.sourceMeta?.path?.startsWith('07-日志')).slice(0, 4);
  const fromMethod = items.filter(i => i.sourceMeta?.path?.startsWith('03-方法论')).slice(0, 4);
  const fromIdentity = items.filter(i => i.sourceMeta?.path?.startsWith('01-身份')).slice(0, 2);

  const samples = [...fromLogs, ...fromMethod, ...fromIdentity].filter(Boolean);
  console.log(`Sampled ${samples.length} items for eval\n`);

  const startTime = Date.now();
  const results = [];

  for (const item of samples) {
    const triagedAt = Date.now();
    const category = await triage(item);
    const triageMs = Date.now() - triagedAt;

    const extractAt = Date.now();
    const fields = await extractByType(item, category);
    const extractMs = Date.now() - extractAt;

    results.push({
      path: item.sourceMeta?.path,
      title: item.title,
      bodyLen: (item.body || '').length,
      category,
      fields,
      triageMs,
      extractMs
    });
  }

  const totalMs = Date.now() - startTime;

  // 打印报告
  console.log('═'.repeat(80));
  console.log(`总耗时: ${(totalMs / 1000).toFixed(1)}s | 平均每条: ${(totalMs / samples.length / 1000).toFixed(2)}s`);
  console.log('═'.repeat(80) + '\n');

  // 类别分布
  const dist = {};
  for (const r of results) dist[r.category] = (dist[r.category] || 0) + 1;
  console.log('分诊结果分布:');
  Object.entries(dist).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log();

  // 详细输出
  for (const r of results) {
    console.log('━'.repeat(80));
    console.log(`📄 ${r.path}`);
    console.log(`   标题: ${r.title}`);
    console.log(`   原文长度: ${r.bodyLen} 字`);
    console.log(`   分诊: ${r.category}  (triage ${r.triageMs}ms · extract ${r.extractMs}ms)`);

    if (!r.fields) {
      console.log(`   → 不入牌堆`);
      continue;
    }

    if (r.fields.summary) {
      console.log(`   summary: ${r.fields.summary}`);
    }
    if (r.fields.insights) {
      console.log(`   insights:`);
      r.fields.insights.forEach((s, i) => console.log(`     ${i + 1}. ${s}`));
    }
    if (r.fields.passage) {
      const p = r.fields.passage.replace(/\n/g, ' ').slice(0, 150);
      console.log(`   passage: ${p}${r.fields.passage.length > 150 ? '...' : ''}`);
    }
  }

  // 把结构化结果存盘，方便后续看
  const outPath = path.join(__dirname, '..', 'data', 'eval-m1-result.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n结果已存: ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
