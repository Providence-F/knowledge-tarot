# 腾讯云 Lighthouse 部署指南（学生 ¥9 上海版 · 8080 端口绕备案）

## 重要：国内地域 vs 香港地域

| 项 | 国内（上海/北京/广州）| 香港 |
|---|---|---|
| 学生套餐 ¥9/月 | ✅ 有 | ❌ 无 |
| 普通价 | 约 ¥30/月 | 约 ¥35/月 |
| 80/443 端口 | ❌ 必须 ICP 备案才能用 | ✅ 直接用 |
| 8080 等非标端口 | ✅ 不需备案 | ✅ |
| 国内访问速度 | ⚡ 极快 < 200ms | ⚡ 1-2s |

**本指南采用方案：上海学生机 ¥9 + 8080 端口（绕过备案）**
访问 URL：`http://<公网IP>:8080`

## 你已经完成
- ✅ 学生认证
- ✅ 准备买**上海**轻量服务器（¥9/月学生价，2核2G）

## 你需要的信息
- 公网 IP（在腾讯云控制台 → 轻量应用服务器 看得到）
- 登录密码（如果买的时候没设，去控制台 **重置密码**）

## 购买配置（重新确认）

| 项 | 必选 |
|---|---|
| 地域 | **上海**（或北京/广州，国内即可） |
| 镜像 | **Ubuntu Server 22.04 LTS** ⚠️ 不要 Windows |
| 套餐 | 2核2G ¥9/月学生 |
| 时长 | 1 个月 |
| 登录方式 | 自定义密码（自己设） |

---

## 一、登录服务器

### Windows 方法 1：用腾讯云网页 SSH（最快）
1. 控制台 → 轻量应用服务器 → 你的实例 → **登录**
2. 选 **WebShell** → 输入密码

### Windows 方法 2：用 PowerShell
```powershell
ssh root@<你的公网IP>
# 或者 ubuntu@<IP>，看你买的镜像默认用户是哪个
# 第一次连接会问 yes/no，输 yes
# 然后输密码
```

### Windows 方法 3：用 PuTTY / FinalShell（图形化）
- 下载 FinalShell：http://www.hostbuf.com/t/988.html（国内速度快）
- Host：你的 IP / Port：22 / 用户：root / 密码：你的密码

---

## 二、一键部署（推荐）

登录服务器后，**复制粘贴这一条命令**：

```bash
curl -fsSL https://raw.githubusercontent.com/Providence-F/knowledge-tarot/main/deploy/setup-lighthouse.sh | sudo bash
```

> 香港机房直连 GitHub 不需要科学，速度很快。
> 脚本会自动装 Node 20 + git + pm2 + nginx + 防火墙，约 3-5 分钟。

部署完会打印 **下一步必须做** 三条提示。

### 接下来填 API Key

```bash
sudo nano /opt/knowledge-tarot/.env
```

把 `请把你的-DEEPSEEK-API-KEY-粘贴到这里` 替换成你的真实 key（`sk-xxx`）。
保存：`Ctrl+O` → `Enter` → `Ctrl+X`

```bash
sudo -u kt pm2 restart knowledge-tarot
```

---

## 三、首次部署还要 seed 公共牌堆

`data/public-deck.json` 是 6.8MB 的文件，**已经在 git 里**，所以 `git clone` 自动带过来了——不用单独上传。

验证：
```bash
ls -lh /opt/knowledge-tarot/data/public-deck.json
# 应该看到 6.8M 左右
```

如果**意外没有**（极少数情况），从你本地传一份：
```powershell
# 在你 Windows PowerShell 里执行（不是服务器）
scp C:\Users\19932\knowledge-tarot\data\public-deck.json root@<你的IP>:/opt/knowledge-tarot/data/
```

---

## 四、🔥 关键：腾讯云控制台开放 8080 端口

国内轻量服务器**默认只放行 80/443/22**，8080 必须手动开！

1. 控制台 → **轻量应用服务器** → 你的实例 → **防火墙** 标签
2. 点 **添加规则**
3. 填：
   - 应用类型：**自定义**
   - 协议：**TCP**
   - 端口：**8080**
   - 来源：**0.0.0.0/0**（所有 IP）
   - 备注：knowledge-tarot
4. 确定

不开这一步浏览器永远打不开！

---

## 五、访问验证

浏览器打开 `http://<你的公网IP>:8080`（**注意 :8080 端口号必须带**）

✅ **国内手机 4G 直连上海，< 500ms**

### 验收清单

```bash
# 1. 服务在跑
sudo -u kt pm2 status
# 应该看到 knowledge-tarot 状态 online

# 2. 看日志
sudo -u kt pm2 logs knowledge-tarot --lines 50
# 应该看到：
#   [public-deck] 已加载: 725 张
#   Knowledge Tarot server running at http://localhost:3456

# 3. 接口能通
curl http://localhost:3456/api/v2/me
# 应该返回 JSON

# 4. nginx 反代正常
curl -I http://localhost
# 应该 200 OK
```

手机打开 `http://<IP>` 跑：
- [ ] onboarding 弹出
- [ ] 选 public 模式 → 抽 1 张牌 → 抽 3 张 → 对话
- [ ] 选 private 模式 → 粘贴文本导入 → 抽牌 → 对话
- [ ] 重启服务后用户数据还在：
  ```bash
  sudo -u kt pm2 restart knowledge-tarot
  ls /opt/knowledge-tarot/data/users/   # 应该能看到你的 32-hex 用户目录
  ```

---

## 五、常用运维

### 更新代码
```bash
cd /opt/knowledge-tarot
sudo -u kt git pull
sudo -u kt pm2 restart knowledge-tarot
```

### 看实时日志
```bash
sudo -u kt pm2 logs knowledge-tarot
# 退出：Ctrl+C
```

### 看错误
```bash
tail -100 /var/log/knowledge-tarot/error.log
```

### 重启 nginx
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 备份用户数据
```bash
sudo tar czf ~/kt-backup-$(date +%Y%m%d).tar.gz -C /opt/knowledge-tarot data/users
# 下载到本地：
# scp root@<IP>:~/kt-backup-*.tar.gz C:\Users\19932\Backups\
```

---

## 六、（可选）绑域名 + HTTPS

如果你有自己的域名（比如阿里云/Namesilo 买的）：

### 1. 域名解析
登录域名服务商控制台 → 添加 A 记录：
- 主机记录：`tarot`（或 `@` 或随便）
- 记录值：你的服务器公网 IP

### 2. 服务器装 certbot
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tarot.yourdomain.com
# 跟着提示填邮箱、同意协议
# certbot 会自动改 nginx 配置 + 申请 Let's Encrypt 免费证书
```

完成后访问 `https://tarot.yourdomain.com` 自动跳 HTTPS。

> 如果没域名，直接用 IP 访问也完全没问题，只是手机上看到 IP 数字别人觉得不专业。

---

## 七、故障排查

### Q: 部署完了 IP 打不开
```bash
# 1. 检查服务有没有起来
sudo -u kt pm2 status

# 2. 检查 nginx
sudo systemctl status nginx

# 3. 检查防火墙
sudo ufw status

# 4. ⚠️ 检查腾讯云控制台的【防火墙规则】
# 控制台 → 轻量应用服务器 → 实例 → 防火墙
# 必须放行 80 端口（默认是放的，但偶尔会被你不小心删了）
```

### Q: pm2 status 显示 errored
```bash
sudo -u kt pm2 logs knowledge-tarot --err --lines 50
# 看具体报错。常见：
# - "Cannot find module" → npm install 没装全，重跑 cd /opt/knowledge-tarot && sudo -u kt npm install --omit=dev
# - "DEEPSEEK_API_KEY undefined" → .env 没填或 PM2 没读到，sudo -u kt pm2 restart knowledge-tarot --update-env
```

### Q: 抽牌后 AI 不回应
```bash
# DeepSeek API 调用失败。检查 key + 网络：
curl -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $(grep DEEPSEEK_API_KEY /opt/knowledge-tarot/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
# 应该返回 JSON。失败说明 key 错了或者 deepseek 端有问题。
```

### Q: 学生套餐到期了怎么办
- 控制台 → 续费 → 学生认证还在的话继续 ¥9
- 学籍过期会涨回正常价 ¥24
