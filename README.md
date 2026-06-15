# Knowledge Tarot · 知识塔罗

把你写过的内容（笔记 / AI 对话 / 灵感）变成一副属于你自己的"塔罗牌"。
不是预测未来，是用 OH 卡式的提问，让你和过去的自己做一次对话。

> 灵感来源：心理学家 Ely Raman 1975 年发明的 OH 卡（Original Hawaiian Cards）——一种被心理治疗师用作"投射性辅助工具"的图卡。本项目把"图卡"换成"你自己写过的文字"。

## 核心机制

塔罗 / OH 卡的真正作用机制不是预测，是 **潜意识投射 + 共时性 + 框架仪式**——
一张随机抽到的、保留模糊性的内容，让你借它说出你早就知道的事。

所以这个项目把所有工程精力放在一件事上：**让 AI 像 OH 卡治疗师那样向你提问，而不是给你答案**。

## 功能

- **多源接入**：Obsidian / DeepSeek / ChatGPT 导出 / 任意 .md / .txt / 直接粘贴
- **智能切片**：LLM 自动识别内容类型（反思 / 观点 / 分析），三种处理策略
- **抽牌仪式**：日签 / 三牌阵（过去-现在-未来），翻牌动画
- **AI 提问引擎**：4 种风格（温柔 / 一针见血 / 哲学思辨 / 玩味段子手），严格禁止鸡汤
- **苏格拉底式深度对话**：围绕一张牌持续追问，让你自己想出答案
- **去重**：7 天 + 本会话双重去重，运行时 LLM 起牌名

## 技术栈

- 后端：Node.js + Express
- LLM：DeepSeek（JSON 模式 + 6 路并发）
- 前端：原生 HTML / Tailwind CSS / 原生 JS
- 存储：文件式 JSON（每用户独立文件夹）
- 用户识别：httpOnly cookie 自动签发，无需注册

## 快速开始

```bash
# 安装
npm install

# 配置 API key
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 启动
npm start
# 打开 http://localhost:3456/v2.html
```

第一次访问会自动签发匿名用户，cookie 保留 1 年。

## 三层架构

```
Source Adapter（适配器）       任意源 → 统一 RawItem
        ↓
Content Triager + Extractor    分诊 6 类，三种提炼策略
        ↓                       reflection: 原文即用（0 LLM 成本）
                                opinion:    轻提炼 summary
                                analysis:   重提炼 summary + 3 条洞察
        ↓
Suit Painter（花色装饰）        LLM 贴 5 个花色（纯视觉）
        ↓
                              用户的牌堆
```

接入新源 = 实现一个 Adapter（50-100 行）。

## 目录结构

```
src/
├── adapters/         多源适配器
├── extractors/       三种提炼器
├── classifiers/      花色 + 旧 Obsidian 路径规则
├── triager.js        内容分诊
├── draw-engine.js    抽牌算法
├── ai-questioner.js  起牌名 + 单牌反思 + 三牌阵 + 深度对话
├── llm.js            DeepSeek 客户端
├── pipeline-v2.js    主流水线（6 路并发）
├── storage.js        文件式存储
└── utils.js

server/
├── index.js          Express 入口
└── v2-routes.js      v2 API 路由

public/
├── v2.html           抽牌主页
├── v2-import.html    导入页
├── css/style.css     黑白极简
└── js/
    ├── v2-app.js
    └── v2-import.js
```

## 路由

- `GET  /v2.html`             抽牌主页
- `GET  /v2-import.html`      导入页
- `GET  /api/v2/me`           当前用户信息
- `POST /api/v2/me/style`     更新风格
- `POST /api/v2/import/text`  粘贴文本导入
- `POST /api/v2/import/files` 文件上传导入
- `GET  /api/v2/deck`         获取牌堆
- `POST /api/v2/draw/single`  抽 1 张
- `POST /api/v2/draw/three`   抽 3 张
- `POST /api/v2/dialogue/turn` 深度对话单轮

## 部署

已配置 Vercel：
```bash
vercel --prod
```

环境变量：在 Vercel 项目设置中添加 `DEEPSEEK_API_KEY`。

## License

MIT
