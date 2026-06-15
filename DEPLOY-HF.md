# 部署到 Hugging Face Spaces（免费 + 国内可访问）

## 前置
- 一个邮箱（用来注册 HF）
- 项目已推到 GitHub：`Providence-F/knowledge-tarot`
- DeepSeek API Key

## 步骤

### 1. 注册 Hugging Face
https://huggingface.co/join — 邮箱秒注册，国内可直连。

### 2. 新建 Space
1. 顶部 **+** → **New Space**
2. **Owner**：你的用户名
3. **Space name**：`knowledge-tarot`（也可叫别的，URL 是 `https://<owner>-<name>.hf.space`）
4. **License**：MIT
5. **SDK**：选 **Docker** → **Blank**（不要选 Gradio/Streamlit）
6. **Hardware**：CPU basic（free）
7. **Visibility**：Public（私有 Space 免费版有限制）
8. **Create Space**

### 3. 把 GitHub 代码同步到 Space

HF Space 本质是一个 git repo。最简单的方式是把 HF Space 当成 GitHub 的镜像：

**方法 A — Space Settings 里直连（推荐）：**
1. 进 Space → **Settings** → 滚到 **Linked Repository**
2. **Connect to GitHub** → 选 `Providence-F/knowledge-tarot` → main 分支
3. HF 会自动同步 GitHub 的 push

**方法 B — 手动 push（如果方法 A 不可用）：**
```powershell
cd C:\Users\19932\knowledge-tarot
git remote add hf https://huggingface.co/spaces/<你的用户名>/knowledge-tarot
git push hf main
# 第一次会让输入 username（HF 用户名）和 password（HF 个人 access token，
# 在 https://huggingface.co/settings/tokens 创建一个 write 权限的）
```

### 4. 配置 Secret（环境变量）

Space → **Settings** → **Variables and secrets** → **New secret**：

| Name | Value | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | sk-xxx | 从本地 `.env` 复制 |

**不需要**手动设 `NODE_ENV` 和 `PORT`，Dockerfile 已经写死了。

### 5. （可选）开启 Persistent Storage
- Space → **Settings** → **Persistent storage** → **Buy storage**
- 免费 Space 可以先**跳过这步**，公共牌堆 demo 不受影响（重启会丢私人导入数据，对种子用户可接受）
- 真要长期保留用户数据再花 $5/月 升级

### 6. 等部署
HF 会自动 build 镜像并启动。第一次约 3-5 分钟。Space 顶部状态：
- **Building** — 构建中
- **Running** — 跑起来了，可以访问
- **Error** — 看 Logs 标签

### 7. 访问
- URL：`https://<你的用户名>-knowledge-tarot.hf.space`
- 国内手机 4G 直接打开（HF 走 Cloudflare CDN，国内可访问）

## 验收清单

- [ ] 国内手机 4G 打开域名 < 5 秒
- [ ] onboarding 弹出，public 牌堆 725 张可抽
- [ ] private 模式：导入 → 抽牌 → 对话全流程
- [ ] DeepSeek API 调用正常

## 注意事项

1. **免费 Space 文件系统不持久**：重启 / redeploy 会丢失 `/data/users/` 下的私人数据，公共牌堆通过启动时 seed 兜底重新生成
2. **48h 空闲休眠**：超过 48 小时无人访问会暂停，下次访问唤醒约 5-10 秒
3. **HF 不会主动暴露 secret**：DEEPSEEK_API_KEY 安全
4. **想要持久化**：开 Persistent Storage（$5/月），数据自动落到 `/data` 卷

## 常见故障

**Space 状态卡 Building 不动**
→ 看 **Logs** → **Build** 标签。一般是 npm install 网络问题，HF 会自动重试。

**启动后访问 502 / 端口错**
→ 检查 Dockerfile 是否暴露 7860（HF Spaces 强制 7860）

**onboarding 弹出但 public 牌堆显示 0 张**
→ 看 **Logs** → **Container** 标签找 `[seed]` 行，应该有 `public-deck.json: ... → /data/public-deck.json`。如果没有，说明镜像里 seed-data 没生成，检查 Dockerfile 里 `cp data/public-deck.json /app/seed-data/`
