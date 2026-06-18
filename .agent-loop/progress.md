# Knowledge Tarot v2.0 "重逢之书" Migration Progress

Last updated: 2026-06-18
Current phase: Phase 2
Active task: T10
Status: Phase 1 complete (T01-T09), starting Phase 2 交互形态

## Phase 0 — 地基

- [x] T01 删 v1 路由 (server/index.js 432→60 行)
- [x] T02 引入 embedding 服务（src/embedder.js + scripts/embedder_worker.py + setup-embedder.sh）
- [x] T03 schema 升级 + migration（schemaVersion=2，每张 card 加 embedding: null）

## Phase 1 — 算法核心

- [x] T04 pipeline-v2 末尾加 embedding 计算
- [x] T05 backfill 脚本给存量卡补 embedding
- [x] T06 cosine > 0.92 去重
- [x] T07 反向 RAG 分桶抽样（draw-engine.js）
- [x] T08 < 30 张降级到纯随机
- [x] T09 跨时间偏权（90 天+ 老卡 2x）

## Phase 2 — 交互形态

- [ ] T10 多步引导式提问 UI
- [ ] T11 question 字段 string → structured object
- [ ] T12 抽牌结果默认陌生化展示
- [ ] T13 抽牌后第一反应输入框
- [ ] T14 AI 不主动开口（draw 接口不返 questions）
- [ ] T15 nameCards 接收 question 参数，不写回 card.title

## Phase 3 — AI prompt 重写

- [ ] T16 system prompt 改为"安静的旁观者"
- [ ] T17 对话最多 3 轮强制收尾
- [ ] T18 history schema 升级（question 三步、dynamicTitle、userReaction、aiCallback）
- [ ] T19 dialogue/turn 改成可选触发

## Phase 4 — 体验补强

- [ ] T20 正逆位（50% 二项随机）
- [ ] T21 ⭐/🚫 反馈通道，⭐ 降权
- [ ] T22 空池友好提示
- [ ] T23 deck 健康度 widget + /api/v2/decks/:id/stats
- [ ] T24 deck 规模分阶段引导文案

## Blockers

（空）

## Decisions made

- 2026-06-17: WIP 8 个未提交文件先打 wip commit b07390b 再启动 loop
- 2026-06-17: embedding 选 Python 子进程方案，复用 Obsidian fastembed + bge-small-zh-v1.5
- 2026-06-17: 启动节奏激进，ScheduleWakeup dynamic mode
- 2026-06-17: T01 验证：v1 /api/interpret + /api/deep-explore POST 都 404；/api/v2/me、/api/health 正常
- 2026-06-18: T02 验证：bge-small-zh-v1.5 加载 4.1s，单 embed 2.58ms（resident），输出 512 维已 L2 归一化，两条相关文本 cosine=0.614（落"若有似无"区 0.4-0.7，反向 RAG 假设成立）
- 2026-06-18: T03 决策：orientation 不入 card schema（draw-time 决定，落 history）。Migration 仅加 schemaVersion=2 + embedding: null，幂等。16 deck / 2082 卡迁移成功
- 2026-06-18: T05：用户 deck embedding 不入 git；公共 + seed deck 部署后 ssh 跑 backfill 自动补
- 2026-06-18: T06：cosine 去重放在 storage.appendCards，阈值 0.92。验证：sim=0.98 文本对成功去重，sim=0.31 不去重。res 多返 `deduped` 字段
- 2026-06-18: T07-T09：draw-engine 反向 RAG，0.4-0.7 sweet 70% / 0.2-0.4 surprise 30%。验证 1000 次抽样 720/280 落在预期。降级条件：< 30 张 / 没 question / 两桶都空。90 天+ 老卡 2x 加权（5000 次抽样 ratio 1.94）。v2-routes 调 embedder.embed(question) 失败时降级，不阻塞用户
