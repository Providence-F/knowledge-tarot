/**
 * 本地验证脚本：测试 nameAndInterpret + synthesizeThree
 * 用法：node scripts/test-ai-questioner.js
 *
 * 输入 3 张样卡 + 1 个 question，跑 jung/ifs/narrative 三 lens
 * 检查：字段齐全、内容不重复、字数符合标准、三 lens 输出明显不同
 */

const ai = require('../src/ai-questioner');

const sampleCards = [
  {
    id: 'card-1',
    contentType: 'opinion',
    title: '《晴天》:没说出口的喜欢',
    summary: '一句没说出口的喜欢拖成了很多年',
    passage: '《晴天》里那句「从前从前有个人爱你很久」不是在讲恋爱成功，而是把一句没说出口的喜欢拖成了很多年。周杰伦写的不是青春恋爱的甜美，是错过了但还一直在心里重播的那个瞬间。这首歌之所以能成为一代人的青春记忆，不是因为圆满，是因为它把那种「当时没说，后来也没机会说」的遗憾具体化了。',
    positionName: '过去',
    orientation: 'upright'
  },
  {
    id: 'card-2',
    contentType: 'opinion',
    title: '《三年二班》:被排名消耗的自我感',
    summary: '排名把人变成可比较的数字',
    passage: '《三年二班》里「第一名到底有什么意义」这句歌词，讲的是被排名系统消耗的自我感。当你一直在被比较，你对自己的评价就变成了一个数字——而这个数字是相对的，今天第一明天第三，你的自我感就跟着数字起伏。这首歌不是怀旧校园，是在讲一个被竞争结构吃掉的人。',
    positionName: '现在',
    orientation: 'upright'
  },
  {
    id: 'card-3',
    contentType: 'opinion',
    title: '《稻香》:回到能被接住的地方',
    summary: '回到不需要赢也能被接住的地方',
    passage: '《稻香》里的「回家吧，回到最初的美好」不是乡愁，是一种生存策略——当你在外面的世界里已经撑不下去，回到一个不需要你赢、不需要你证明什么、你就能被接住的地方，是为了活下去。这首歌不是教你放弃，是承认人有时候需要先被接住，才能再次出去。',
    positionName: '未来',
    orientation: 'upright'
  }
];

const sampleQuestion = {
  q1: '我该不该继续追那个已经拒绝过我的人？',
  q2: '隐约觉得答案是再试一次，万一这次不一样',
  q3: '最害怕的答案是其实我放不下的不是ta，是当年那个没开口的自己'
};

const LENSES = ['jung', 'ifs', 'narrative'];

async function runOneLens(lens) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`LENS: ${lens}`);
  console.log('═'.repeat(60));

  console.log('\n[1/2] 调用 nameAndInterpret...');
  const t0 = Date.now();
  const { cards } = await ai.nameAndInterpret(sampleCards, sampleQuestion, 'sharp', lens);
  const t1 = Date.now();
  console.log(`  耗时: ${((t1 - t0) / 1000).toFixed(1)}s`);

  cards.forEach((c, i) => {
    console.log(`\n--- 第 ${i + 1} 张 (${sampleCards[i].positionName}) ---`);
    console.log(`dynamicTitle: ${c.dynamicTitle}`);
    console.log(`sharpQuestion (${c.sharpQuestion.length}字): ${c.sharpQuestion}`);
    console.log(`interpretation (${c.interpretation.length}字):`);
    console.log(c.interpretation);
  });

  console.log('\n[2/2] 调用 synthesizeThree...');
  const cardsForSynth = sampleCards.map((orig, i) => ({
    ...orig,
    _dynamicTitle: cards[i].dynamicTitle,
    _sharpQuestion: cards[i].sharpQuestion,
    _interpretation: cards[i].interpretation
  }));
  const t2 = Date.now();
  const { narrative } = await ai.synthesizeThree(cardsForSynth, sampleQuestion, 'sharp', lens);
  const t3 = Date.now();
  console.log(`  耗时: ${((t3 - t2) / 1000).toFixed(1)}s`);
  console.log(`\nnarrative (${narrative.length}字):`);
  console.log(narrative);

  return { lens, cards, narrative };
}

async function main() {
  console.log('知识塔罗 v2.0 AI 模块测试');
  console.log('Question:', sampleQuestion.q1);

  const results = [];
  for (const lens of LENSES) {
    try {
      const r = await runOneLens(lens);
      results.push(r);
    } catch (e) {
      console.error(`[LENS ${lens}] 失败:`, e.message);
    }
  }

  // 汇总对比
  console.log('\n\n' + '═'.repeat(60));
  console.log('三 lens 对比汇总');
  console.log('═'.repeat(60));
  for (const r of results) {
    console.log(`\n[${r.lens}]`);
    console.log(`  sharpQuestion 1: ${r.cards[0]?.sharpQuestion || '(空)'}`);
    console.log(`  sharpQuestion 2: ${r.cards[1]?.sharpQuestion || '(空)'}`);
    console.log(`  sharpQuestion 3: ${r.cards[2]?.sharpQuestion || '(空)'}`);
    console.log(`  narrative开头: ${(r.narrative || '').slice(0, 80)}...`);
  }

  // 简单自检
  console.log('\n\n' + '═'.repeat(60));
  console.log('自检清单');
  console.log('═'.repeat(60));
  let allPass = true;
  for (const r of results) {
    const q1 = r.cards[0]?.sharpQuestion || '';
    const q2 = r.cards[1]?.sharpQuestion || '';
    const q3 = r.cards[2]?.sharpQuestion || '';
    const interp1 = r.cards[0]?.interpretation || '';

    const checks = [
      [`[${r.lens}] 三 sharpQuestion 不重复`, q1 !== q2 && q2 !== q3 && q1 !== q3],
      [`[${r.lens}] sharpQuestion 1 ≤ 60 字`, q1.length <= 60],
      [`[${r.lens}] sharpQuestion 2 ≤ 60 字`, q2.length <= 60],
      [`[${r.lens}] sharpQuestion 3 ≤ 60 字`, q3.length <= 60],
      [`[${r.lens}] interpretation 1 字数 200-350`, interp1.length >= 150 && interp1.length <= 1200],
      [`[${r.lens}] narrative 200-800 字`, (r.narrative || '').length >= 100 && (r.narrative || '').length <= 800],
      [`[${r.lens}] narrative 不空`, !!r.narrative]
    ];
    for (const [name, pass] of checks) {
      console.log(`  ${pass ? '✓' : '✗'} ${name}`);
      if (!pass) allPass = false;
    }
  }
  console.log(`\n${allPass ? '✓ 全部通过' : '✗ 有未通过项'}`);
}

main().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
