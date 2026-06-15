# Zeabur 香港部署指南

## 一、准备（已完成）
- ✅ `package.json` 加 `engines.node >= 18`
- ✅ `.dockerignore` 排除 node_modules/data/users/.env
- ✅ `data/public-deck.json` 已 commit 进仓库（首次部署即带公共牌堆）
- ✅ Cookie `secure: NODE_ENV === 'production'`
- ✅ Server 监听 `process.env.PORT`

## 二、Zeabur 操作步骤

1. https://zeabur.com 注册/登录（用 GitHub 即可）
2. **New Project** → 选 **Hong Kong** region（关键，国内直连）
3. **Add Service** → **Git** → 选 `Providence-F/knowledge-tarot` repo → main 分支
4. Zeabur 自动识别为 Node.js 项目，会跑 `npm start`
5. **环境变量**（Service → Variables）：
   - `DEEPSEEK_API_KEY` = sk-xxx（从本地 `.env` 复制）
   - `NODE_ENV` = `production`
6. **Volume** 持久化：
   - Service → Volumes → New Volume
   - Name: `kt-data` / Mount Path: `/src/data`
   - 容量 1GB 起步够用
7. **Networking** → Generate Domain（或绑自己的域名）
8. **Redeploy**（让 volume 生效）

## 三、首次部署后 seed 公共牌堆
因为 Volume 会盖住容器内的 `data/`，首次部署后需把 `public-deck.json` 拷进 volume：

**方法 A（推荐）**：Zeabur 后台 → Service → Console → 进容器 shell：
```bash
# 容器里 git 拉的代码在 /src，volume 挂在 /src/data
ls /src/data            # 应该是空的（被 volume 覆盖了）
# 从 git 工作区复制（Zeabur 通常保留 build 产物）
# 如果找不到，用下面方法 B
```

**方法 B**：本地用 scp/zeabur cli 上传 `data/public-deck.json` 到 volume

**方法 C（最稳）**：在 `server/index.js` 启动时检测 volume 里没有 public-deck.json 就从 build 产物里复制一份过去——可加但不必须，反正 demo 牌堆只读。

## 四、验收清单
- [ ] 国内手机 4G 打开域名 < 3 秒
- [ ] onboarding 弹出，public 牌堆 725 张可抽
- [ ] private 模式：导入 → 抽牌 → 对话全流程
- [ ] 重启容器后 `data/users/{uid}/deck.json` 还在
- [ ] DeepSeek API 调用正常

## 五、删除 Vercel 残留（部署成功后再做）
```bash
rm vercel.json
rm -rf .vercel
git add -A && git commit -m "chore: remove vercel config (migrated to zeabur)"
git push
```
