/**
 * scripts/build-seed-decks.js — 生成高质量示范牌堆
 *
 * 输出: data/seed-decks/{slug}.json
 *       data/seed-decks/registry.json
 *
 * 用法:
 *   node scripts/build-seed-decks.js
 *   node scripts/build-seed-decks.js --only=harry-potter
 *   node scripts/build-seed-decks.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_DIR = path.join(__dirname, '..', 'data', 'seed-decks');
const ARGS = process.argv.slice(2);
const ONLY = (ARGS.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;
const DRY_RUN = ARGS.includes('--dry-run');

const SEED_DEFS = [
  {
    slug: 'harry-potter',
    name: '哈利波特金句',
    description: '从七部小说的关键场景中抽取成长、选择、恐惧、友谊与死亡教育。',
    emoji: '⚡',
    order: 1,
    build: buildHarryPotterCards
  },
  {
    slug: 'world-decisions',
    name: '世界历史重大决策',
    description: '把历史上的关键选择做成决策卡：背景、选项、代价、后果和可迁移的判断模型。',
    emoji: '🏛️',
    order: 2,
    build: buildWorldDecisionCards
  }
];

const EXTRA_SEED_DEFS = [
  {
    slug: 'kai-vault-250',
    name: 'AI革命生存指南精选',
    description: '从 Kai 的 Obsidian 知识库中严格筛选出的 250 张判断卡。',
    emoji: '🧭',
    order: 3
  },
  {
    slug: 'pmthinking-links',
    name: '产品沉思录索引',
    description: '产品沉思录公开文章的标题与原文链接索引；不复制正文，点击回原站查看。',
    emoji: '📝',
    order: 4
  },
  {
    slug: 'deepseek-curated-250',
    name: 'DeepSeek 对话精选 250',
    description: '从 720 张历史对话卡中严格筛选并重写出的 250 张判断卡。',
    emoji: '🧠',
    order: 5
  }
];

const SUITS = [
  ['seed-of-growth', '成长之种'],
  ['mirror-of-world', '世界之镜'],
  ['blade-of-truth', '真相之刃'],
  ['cup-of-memory', '记忆之杯']
];

function stableId(slug, idx, title) {
  return crypto.createHash('sha1').update(`${slug}:${idx}:${title}`).digest('base64url').slice(0, 8).toLowerCase();
}

function pickSuit(seed) {
  return SUITS[Math.abs(seed) % SUITS.length];
}

function createCard(slug, idx, contentType, title, summary, passage, tags = []) {
  const [suit, suitName] = pickSuit(idx + title.length);
  const now = Date.now();
  return {
    id: stableId(slug, idx, title),
    contentType,
    title,
    summary,
    passage,
    fullPassage: passage,
    insights: null,
    suit,
    suitName,
    source: { type: 'seed', path: null, label: slug },
    createdAt: now + idx,
    tags
  };
}

function extractInsights(passage) {
  return String(passage)
    .split('\n')
    .filter(line => /^(选项|代价|后果|可迁移判断)/.test(line))
    .map(line => line.replace(/^.+?：/, '').trim())
    .filter(Boolean)
    .slice(0, 4);
}


function shortTitle(text) {
  const firstClause = text.replace(/[，。！？；：].*$/, '');
  return firstClause.length > 12 ? firstClause.slice(0, 12) : firstClause;
}

function buildHarryPotterCards() {
  const rows = [
    ['魔法石', '1997', '碗橱里的男孩', '被忽视的孩子第一次知道自己不是错误', '身份不是别人给你的解释，而是你终于能讲出的名字。'],
    ['魔法石', '1997', '霍格沃茨来信', '一封信击穿德思礼家的控制系统', '真正的召唤会反复敲门，直到你不得不听见。'],
    ['魔法石', '1997', '九又四分之三站台', '进入新世界需要一次看似荒唐的冲刺', '过门槛时最需要的不是证据，是一点点信任。'],
    ['魔法石', '1997', '分院帽', '能力、欲望与选择第一次交锋', '你被分到哪里，不等于你只能成为什么。'],
    ['魔法石', '1997', '厄里斯魔镜', '哈利看见失去的父母', '欲望最危险的地方，是它让你误以为凝视等于拥有。'],
    ['魔法石', '1997', '赫敏的举手', '知识型人格被误解成炫耀', '聪明如果没有被接住，就会先表现为孤独。'],
    ['魔法石', '1997', '罗恩的巫师棋', '牺牲自己换团队通关', '有些人的价值，不在最亮处，而在关键时刻敢让位。'],
    ['魔法石', '1997', '斯内普的误判', '讨厌的人也可能在保护你', '世界不是按你的好恶分阵营。'],
    ['魔法石', '1997', '奇洛的后脑', '真正的危险藏在怯懦背后', '软弱不一定无害，它可能只是把责任交给了更坏的东西。'],
    ['魔法石', '1997', '莉莉的保护', '爱成为比咒语更旧的魔法', '真正保护你的，往往是你已经失去却仍在起作用的关系。'],
    ['密室', '1998', '蛇佬腔', '哈利发现自己和敌人共享某种能力', '和黑暗相似，不等于你属于黑暗。'],
    ['密室', '1998', '多比的警告', '笨拙的保护造成麻烦', '不是所有帮忙都有效，但它暴露了谁真的在乎你。'],
    ['密室', '1998', '日记本', '汤姆里德尔用文字制造亲密', '能回应你的东西，不一定真的理解你。'],
    ['密室', '1998', '金妮的沉默', '羞耻让受害者更难求救', '秘密越孤立，越容易被操控。'],
    ['密室', '1998', '洛哈特的微笑', '名声掩盖空心', '包装精美的人，可能最害怕真实测试。'],
    ['密室', '1998', '赫敏石化', '最会解决问题的人暂时离场', '团队不能只依赖一个大脑。'],
    ['密室', '1998', '福克斯的眼泪', '凤凰在绝境中带来治疗', '有些帮助不是提前计划的，是你撑到那里才出现的。'],
    ['密室', '1998', '格兰芬多宝剑', '真正需要时，资格才被确认', '勇气不是自称拥有，是被处境逼出来仍然站住。'],
    ['密室', '1998', '释放多比', '一只袜子打破奴役契约', '自由有时开始于一个小到荒唐的动作。'],
    ['密室', '1998', '不是斯莱特林', '哈利拒绝被血统叙事定义', '你选择反抗什么，比你继承了什么更重要。'],
    ['阿兹卡班囚徒', '1999', '摄魂怪', '创伤以寒冷的形式回到身体', '有些恐惧不是想法，而是身体记得太清楚。'],
    ['阿兹卡班囚徒', '1999', '卢平的课', '老师先教学生面对恐惧的形状', '恐惧被命名以后，才有可能被训练。'],
    ['阿兹卡班囚徒', '1999', '博格特衣柜', '每个人的恐惧都很具体', '不要嘲笑别人的怕，那里面有他的历史。'],
    ['阿兹卡班囚徒', '1999', '活点地图', '秘密通道与被看见的人', '系统之外，总有人留下通往自由的小路。'],
    ['阿兹卡班囚徒', '1999', '小天狼星真相', '通缉犯可能是家人', '真相迟到时，受害者已经付过太多利息。'],
    ['阿兹卡班囚徒', '1999', '彼得的背叛', '最不起眼的人造成最大损害', '危险不总是强大，也可能是长期逃避责任。'],
    ['阿兹卡班囚徒', '1999', '时间转换器', '改变结果需要重复承受过程', '成熟不是重来一次，而是知道重来仍然很痛。'],
    ['阿兹卡班囚徒', '1999', '守护神咒', '哈利用快乐记忆抵抗黑暗', '你的光不是抽象希望，而是某个具体记忆。'],
    ['阿兹卡班囚徒', '1999', '巴克比克逃脱', '法律正确不等于正义抵达', '有时必须先救下生命，再慢慢解释程序。'],
    ['阿兹卡班囚徒', '1999', '月圆的卢平', '好人也有不可控的一面', '亲密关系需要爱，也需要边界和预案。'],
    ['火焰杯', '2000', '三强争霸报名', '哈利被推入不属于他的比赛', '不是每场竞争都是你选择的，但你仍要决定怎么站上去。'],
    ['火焰杯', '2000', '穆迪的课堂', '防御课第一次接近残酷现实', '教育如果只讲安全，就无法训练人面对危险。'],
    ['火焰杯', '2000', '第一项火龙', '公开场合下处理恐惧', '把注意力从观众转回任务，是临场发挥的开始。'],
    ['火焰杯', '2000', '圣诞舞会', '青春期的自尊和笨拙', '人际关系里最难的不是喜欢，是不会表达。'],
    ['火焰杯', '2000', '第二项湖底', '人质考验价值排序', '你会为谁多停留一分钟，暴露了你真正的伦理。'],
    ['火焰杯', '2000', '丽塔斯基特', '媒体把人压扁成故事', '被叙述时，你不一定拥有解释权。'],
    ['火焰杯', '2000', '塞德里克之死', '优秀的人也会被卷入恶意', '世界不保证善良的人安全。'],
    ['火焰杯', '2000', '伏地魔复活', '否认不会阻止危险回来', '如果现实已经变坏，最糟的是继续假装正常。'],
    ['火焰杯', '2000', '双胞胎的玩笑', '幽默作为抵抗机制', '笑不是不严肃，有时是没被击垮的证据。'],
    ['火焰杯', '2000', '邓布利多的相信', '一个成年人愿意相信孩子的证词', '被相信，是创伤后重新站起来的第一块地板。'],
    ['凤凰社', '2003', '乌姆里奇', '甜腻外表下的制度暴力', '真正可怕的控制，往往穿着礼貌的粉色外套。'],
    ['凤凰社', '2003', '邓布利多军', '学生自组织学习防御', '当正式系统失灵，地下课堂会长出来。'],
    ['凤凰社', '2003', '哈利的愤怒', '创伤后的易怒被误读成叛逆', '有些脾气不是性格差，是痛没有地方放。'],
    ['凤凰社', '2003', '预言球', '命运被误解成单向剧本', '预言不是命令，它只是制造选择压力。'],
    ['凤凰社', '2003', '秋张的眼泪', '哀悼与恋爱混在一起', '两个都在失去的人，不一定能互相拯救。'],
    ['凤凰社', '2003', '小天狼星离开', '第二个家人再次消失', '重复失去会让人误以为自己不配被留下。'],
    ['凤凰社', '2003', '卢娜的平静', '怪女孩提供非标准安慰', '有些安慰不是解决问题，而是承认世界确实很奇怪。'],
    ['凤凰社', '2003', '魔法部不信', '机构为了面子延迟承认真相', '组织最危险的时刻，是它先保护叙事而不是人。'],
    ['凤凰社', '2003', '伤疤连接', '敌人进入你的感知系统', '共感不是亲密，也可能是一种入侵。'],
    ['凤凰社', '2003', '邓布利多的距离', '保护被误解成冷落', '出于爱而保持距离，仍然会让对方受伤。'],
    ['混血王子', '2005', '旧课本批注', '陌生人的笔记变成外挂', '别人的方法能帮你赢，也可能让你失去判断。'],
    ['混血王子', '2005', '斯拉格霍恩', '人脉、收藏与羞耻记忆', '有些人不是坏，只是太擅长靠近有用的人。'],
    ['混血王子', '2005', '魂器课题', '伏地魔把死亡焦虑拆成物件', '极端控制欲，常常来自无法承受有限性。'],
    ['混血王子', '2005', '德拉科的任务', '少年被家族政治推向杀人', '加害者也可能是被系统逼坏的孩子，但这不取消责任。'],
    ['混血王子', '2005', '山洞药水', '邓布利多喝下痛苦记忆', '领导者真正的重量，是把最难吞的东西先吞下去。'],
    ['混血王子', '2005', '天文塔', '信任在最高处坠落', '最刺痛的背叛，是你曾经把命交给过他。'],
    ['混血王子', '2005', '混血王子的身份', '斯内普的过去浮出水面', '一个人的标签越简单，背后的伤口通常越复杂。'],
    ['混血王子', '2005', '金妮与哈利', '战时仍然发生的喜欢', '生活不会等危机结束才允许你爱人。'],
    ['混血王子', '2005', '罗恩中毒', '喜剧角色也会接近死亡', '不要把开朗的人默认成安全。'],
    ['混血王子', '2005', '没有葬礼式答案', '邓布利多死后任务仍未清晰', '有些导师离开前不会把地图画完。'],
    ['死亡圣器', '2007', '七个哈利', '集体冒险用伪装换生路', '被保护不是丢脸，那说明你值得别人冒险。'],
    ['死亡圣器', '2007', '魂器项链', '负面情绪被物件放大', '有些东西戴久了，你会误以为那就是自己的声音。'],
    ['死亡圣器', '2007', '罗恩离队', '最亲的人也会被恐惧击穿', '离开不总是不爱，也可能是承受力先崩了。'],
    ['死亡圣器', '2007', '银色牝鹿', '引路者不解释，只出现', '真正关键的帮助，常常不署名。'],
    ['死亡圣器', '2007', '贝拉特里克斯金库', '财富、恐惧与复制咒', '贪婪会让每件东西都变成障碍。'],
    ['死亡圣器', '2007', '马尔福庄园', '赫敏被折磨仍守住信息', '勇敢不是不怕痛，是痛到极限仍不出卖别人。'],
    ['死亡圣器', '2007', '多比之死', '自由的小精灵死在救援之后', '最小的人物，也能留下最大的道德重量。'],
    ['死亡圣器', '2007', '斯内普记忆', '仇恨背后藏着长期守护', '人的复杂性，常常迟到到无法道歉。'],
    ['死亡圣器', '2007', '禁林赴死', '哈利主动走向死亡', '最高级的勇气不是战斗，是明知道结局仍然选择承担。'],
    ['死亡圣器', '2007', '纳威斩蛇', '边缘角色完成关键一击', '长期被低估的人，也可能是最后的支点。'],
    ['死亡圣器', '2007', '老魔杖失效', '权力误判忠诚的流向', '控制工具的人，未必真的拥有工具。'],
    ['死亡圣器', '2007', '十九年后', '创伤没有消失，但生活继续', '幸存不是回到原样，而是在废墟上建立日常。']
  ];

  return rows.map((r, idx) => {
    const [book, year, scene, background, insight] = r;
    const title = `${scene}：${shortTitle(insight)}`;
    const summary = `${scene}把《${book}》里的一个成长问题推到台前：${insight}`;
    const passage = [
      `《哈利波特与${book}》｜${year}`,
      '',
      `${scene}。${background}`,
      '',
      `${insight}`
    ].join('\n');
    return createCard('harry-potter', idx, 'reflection', title, summary, passage, ['harry-potter', book, scene]);
  });
}

function buildWorldDecisionCards() {
  const rawPath = path.join(__dirname, 'world-decisions-100.json');
  const rows = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  return rows.map((r, idx) => {
    const [event, time, arena, background, options, outcome, lesson, quote, quoteNote] = r;
    const title = `${event}：${shortTitle(lesson)}`;
    const summary = `${time}，${arena}的关键选择：${lesson}`;
    // 把骨架字段融合成流畅叙事，去标签化
    let passage = '';
    passage += `${time}，${arena}。${background}\n\n`;
    if (quote) {
      passage += `${quote}——${quoteNote}\n\n`;
    }
    passage += `${options} 最终，${outcome}\n\n`;
    passage += `${lesson}`;
    return createCard('world-decisions', idx, 'analysis', title, summary, passage, ['history', arena, time]);
  });
}

// 旧 60 张数据已全部整合进 world-decisions-100.json
async function buildOne(def) {
  const cards = def.build();
  console.log(`  ${def.slug}: ${cards.length} 张卡`);

  if (DRY_RUN) {
    console.log(`     dry-run; 第一张: ${cards[0]?.title}`);
    return { def, totalCards: cards.length, dryRun: true };
  }

  const now = Date.now();
  const deck = {
    id: `seed-${def.slug}`,
    slug: def.slug,
    ownerId: 'system',
    name: def.name,
    description: def.description,
    emoji: def.emoji,
    visibility: 'system-readonly',
    createdAt: now,
    updatedAt: now,
    totalCards: cards.length,
    lastImport: { source: 'seed-build-v2', at: now, strategy: 'curated-structured-cards' },
    cards
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${def.slug}.json`), JSON.stringify(deck, null, 2));
  return { def, totalCards: cards.length };
}

async function main() {
  const targets = ONLY ? SEED_DEFS.filter(d => d.slug === ONLY) : SEED_DEFS;
  if (targets.length === 0) {
    console.error(`无匹配 seed: ${ONLY}`);
    process.exit(1);
  }

  console.log(`[build-seed-decks] mode=${DRY_RUN ? 'dry-run' : 'apply'}, targets=${targets.map(t => t.slug).join(',')}`);

  const results = [];
  for (const def of targets) {
    results.push(await buildOne(def));
  }

  if (DRY_RUN) return;

  const registry = [...SEED_DEFS, ...EXTRA_SEED_DEFS].map(def => {
    const file = path.join(OUT_DIR, `${def.slug}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`  ! 缺少外部 seed deck 文件，跳过 registry: ${def.slug}`);
      return null;
    }
    const deck = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return {
      id: `seed-${def.slug}`,
      slug: def.slug,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      totalCards: deck.cards?.length || 0,
      order: def.order
    };
  }).filter(Boolean).sort((a, b) => (a.order || 99) - (b.order || 99));

  fs.writeFileSync(path.join(OUT_DIR, 'registry.json'), JSON.stringify(registry, null, 2));
  console.log(`\n✓ 写入 registry.json (${registry.length} decks)`);
  console.log(registry.map(r => `  - ${r.emoji} ${r.name} (${r.totalCards} cards)`).join('\n'));
}

main().catch(e => {
  console.error('Failed:', e);
  process.exit(1);
});
