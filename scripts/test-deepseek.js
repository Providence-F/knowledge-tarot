/**
 * scripts/test-deepseek.js — DeepSeek 真实数据端到端测试
 *
 * 取 10 条最深的对话（messages 多 = 用户来回讨论 = 更可能产生洞察）
 * 跑 Triager + Extractor + suit-painter 全流程
 * 打印结果让用户判断质量
 */

const fs = require('fs');
const path = require('path');
const ds = require('../src/adapters/deepseek');
const { triage } = require('../src/triager');
const { extractByType } = require('../src/extractors');
const { paintSuit } = require('../src/classifiers/suit-painter');

async function main() {
  const jsonPath = process.argv[2] || 'C:/Users/19932/AppData/Local/Temp/deepseek-export/conversations.json';
  const sampleN = Number(process.argv[3]) || 10;

  console.log(`Loading: ${jsonPath}`);
  const json = fs.readFileSync(jsonPath, 'utf-8');
  const items = ds.loadFromJSON(json);
  console.log(`Total RawItems: ${items.length}`);

  // 按 messageCount 排序（深对话优先），取前 sampleN 条
  const samples = items
    .slice()
    .sort((a, b) => (b.sourceMeta?.messageCount || 0) - (a.sourceMeta?.messageCount || 0))
    .slice(0, sampleN);

  console.log(`Sampled ${samples.length} (深度对话优先)\n`);
  samples.forEach((s, i) => {
    console.log(`  ${i+1}. [${s.sourceMeta.messageCount} msgs · ${(s.body.length/1000).toFixed(1)}KB] ${s.title}`);
  });
  console.log();

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < samples.length; i++) {
    const item = samples[i];
    process.stdout.write(`[${i+1}/${samples.length}] ${item.title.slice(0, 30)}... `);

    const t0 = Date.now();
    const category = await triage(item);
    const t1 = Date.now();
    const fields = await extractByType(item, category);
    const t2 = Date.now();
    let suit = null;
    if (fields) {
      suit = await paintSuit(fields);
    }
    const t3 = Date.now();

    process.stdout.write(`${category} (${((t3-t0)/1000).toFixed(1)}s)\n`);

    results.push({
      title: item.title,
      msgCount: item.sourceMeta.messageCount,
      bodyLen: item.body.length,
      category,
      triageMs: t1-t0,
      extractMs: t2-t1,
      suitMs: t3-t2,
      fields,
      suit
    });
  }

  const totalMs = Date.now() - startTime;
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`总耗时: ${(totalMs/1000).toFixed(1)}s · 平均每条: ${(totalMs/samples.length/1000).toFixed(2)}s`);

  // 类别分布
  const dist = {};
  results.forEach(r => dist[r.category] = (dist[r.category]||0) + 1);
  console.log(`\n分诊分布: ${JSON.stringify(dist)}`);

  // 打印每条的提炼结果
  for (const r of results) {
    console.log('\n' + '━'.repeat(80));
    console.log(`📄 ${r.title}`);
    console.log(`   ${r.msgCount} msgs · ${r.bodyLen}字 · 分诊: ${r.category}` +
                `  (triage ${r.triageMs}ms · extract ${r.extractMs}ms · suit ${r.suitMs}ms)`);

    if (!r.fields) {
      console.log(`   → 不入牌堆`);
      continue;
    }

    if (r.suit) {
      console.log(`   花色: ${r.suit.suitName} (confidence ${r.suit.confidence})`);
    }
    if (r.fields.summary) {
      console.log(`   summary: ${r.fields.summary}`);
    }
    if (r.fields.insights) {
      console.log(`   insights:`);
      r.fields.insights.forEach((s, i) => console.log(`     ${i+1}. ${s}`));
    }
    if (r.fields.passage) {
      const p = r.fields.passage.replace(/\n/g, ' ').slice(0, 180);
      console.log(`   passage: ${p}${r.fields.passage.length > 180 ? '...' : ''}`);
    }
  }

  // 全量成本估算
  const avgMs = totalMs / samples.length;
  const avgCostPerCard = (
    Object.entries(dist).reduce((sum, [cat, n]) => {
      const c = cat === 'reflection' ? 0.0004 :
                cat === 'opinion' ? 0.0014 :
                cat === 'analysis' ? 0.0034 : 0;
      return sum + c * n;
    }, 0) / samples.length
  );

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`全量 ${items.length} 条估算:`);
  console.log(`  时间: ${(avgMs * items.length / 1000 / 60).toFixed(1)} 分钟（按当前并发率）`);
  console.log(`  成本: ${(avgCostPerCard * items.length).toFixed(2)} 元`);

  // 存盘
  const outPath = path.join(__dirname, '..', 'data', 'eval-deepseek-result.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n结果存盘: ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
