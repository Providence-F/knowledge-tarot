# Findings · Decisions · Open Questions

时间倒序记录。每条独立可读，不依赖前文。

---

## 2026-06-17 · T01 v1 路由删除

**操作**：删 server/index.js 第 46-416 行（约 370 行）。范围包括：
- `STYLE_AND_BAN`、`SYSTEM_PROMPT_SINGLE/_NO_QUESTION`、`SYSTEM_PROMPT_THREE/_NO_QUESTION` 4 个 system prompt 常量
- `/api/interpret` POST 路由 + `buildPrompt` + `buildFallback` + `parseAIResponse` + `salvageFields`
- `/api/deep-explore` POST 路由 + `buildDeepExplorePrompt`

**保留**：dotenv、Express 启动、static、`/api/v2/*`（v2-routes.js）、`/api/health`、`/share/:token`、SPA fallback、listen。

**未清理（留作后续工程债）**：`public/js/ai.js` (call /api/interpret) 和 `public/js/renderer.js` (call /api/deep-explore) 是 v1 frontend 死代码，没有任何 HTML 加载它们，先留着不动。后续 Phase 2 改前端时一起删。

**验证**：本地 3457 端口，`POST /api/interpret` → 404，`POST /api/deep-explore` → 404，`/api/v2/me` → 200，`/api/health` → 200。

**没做**：`git push` 暂未推（用户说 loop 内可以 push 但 wip commit 在我前面，要先 push 一次让 origin 同步）。下次循环开始前推。
