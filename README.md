# 知识塔罗 (Knowledge Tarot)

从你的知识库中寻找指引的 AI 塔罗解读工具。

## 功能特性

- 🃏 **两种牌阵**：日签（单牌）、三牌阵（过去/现在/未来）
- 🔒 **隐私模式**：本地模板解读 vs 云端 AI 解读
- 🤖 **AI 解读**：调用 Claude API，综合你的知识库进行深度解读
- 📊 **651 张卡牌**：从 Obsidian 知识库自动生成

## 技术栈

- **后端**：Express.js + Claude API
- **前端**：原生 HTML/CSS/JS（无框架）
- **数据**：从 Obsidian 笔记生成的 JSON 卡牌库

## 本地运行

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的 Claude API Key

# 启动服务
npm start
# 访问 http://localhost:3456
```

## 部署到 Vercel

1. Fork 本仓库
2. 在 [Vercel](https://vercel.com) 导入项目
3. 添加环境变量：
   - `CLAUDE_API_KEY`：你的 Claude API Key
   - `ANTHROPIC_BASE_URL`：API 地址（可选）
4. 部署完成

## 项目结构

```
knowledge-tarot/
├── server/index.js      # Express 后端
├── public/              # 静态前端
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js       # 主逻辑
│       ├── deck.js      # 抽牌算法
│       ├── ai.js        # AI 调用
│       └── renderer.js  # 渲染
├── data/cards.json      # 卡牌数据（651张）
├── config/              # 花色映射配置
└── scripts/             # 构建脚本
```

## License

MIT
