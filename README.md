# 家稳云图

中国家庭风险缓冲与 AI 理财服务平台静态 MVP。

## 本地预览

直接打开 `index.html`，或在项目目录启动静态服务器：

```powershell
python -m http.server 5173
```

## 推荐部署结构

- 前端：Cloudflare Pages（静态资源）
- AI 后端：Cloudflare Worker
- 模型：DeepSeek 官方 `deepseek-v4-flash`（非思考模式，流式输出）

静态网页请求可使用 Pages 免费额度，AI 密钥只保存在 Worker Secret 中。App 并不能代替公网 AI 后端，因此当前阶段优先把响应式网站上线，成本和维护量都更低。

详细步骤见 [`公网部署说明.md`](./公网部署说明.md)。

## 数据与隐私

- 问卷、评分和报告在浏览器本地计算，不写入服务器数据库。
- 用户主动使用 AI 顾问时，只发送生成回答所需的家庭画像摘要和问题。
- 不应收集或发送身份证号、银行卡号、账户密码、详细住址等敏感信息。
- 自定义模型密钥仅保留在当前页面内存中，刷新或关闭页面后清除。

## 开源 AI 模型接入

AI 顾问默认由 **DeepSeek-V4-Flash** 大模型驱动（经 Cloudflare Worker 安全代理调用 DeepSeek 官方 API），问答费用由项目方承担。

在网页 `AI顾问` -> `AI 服务详情（高级）` 中可以：

- 查看当前模型与连接状态（"测试连接"可验证服务是否可用）；
- 接入自己的模型服务（如 DeepSeek 官方、Kimi、通义等 OpenAI 兼容接口）；
- 使用本地 Ollama 离线运行。

### 本地 Ollama（可选）

```powershell
ollama pull deepseek-r1:8b
ollama serve
```

然后在网页 `AI顾问` -> `AI 服务详情（高级）` 中选择"使用我自己的模型服务"，填写：

- 接口地址：`http://localhost:11434/api/chat`
- 模型名称：`deepseek-r1:8b`

注意：GitHub Pages 是纯静态托管，不能安全保存 API Key。若要让所有公网用户都使用同一个真实 AI 服务，需要额外部署后端代理。

## Cloudflare Worker 代理

本项目已部署 Worker：`https://jiawen-ai.jiangying10111222.workers.dev`

如需在其他账号/环境重新部署：

1. 在 Cloudflare 创建 Worker。
2. 将本仓库的 `worker.js` 复制到 Worker 编辑器。
3. 在 Worker 的环境变量与 Secrets 中添加：
   - 变量名：`MODEL_API_KEY`
   - 变量值：你的模型服务商 API Key（默认为硅基流动）
   - 变量名：`ALLOWED_ORIGINS`
   - 变量值：正式前端域名，多个域名用英文逗号分隔
   - 变量名：`MODEL_API_BASE`（可选，用于切换服务商）
   - 变量值：如 `https://api.deepseek.com/v1/chat/completions`、`https://api.moonshot.cn/v1/chat/completions` 等 OpenAI 兼容地址；不填则使用硅基流动
4. 如需联网搜索，再添加 Tavily 搜索 API Key：
   - 变量名：`TAVILY_API_KEY`
   - 变量值：你的 Tavily API Key
5. 部署 Worker，得到类似 `https://xxx.workers.dev` 的地址。
6. 在 `app.js` 中确认默认值：
   - `DEFAULT_AI_ENDPOINT` 为你的 Worker 地址
   - `DEFAULT_AI_MODEL` 为 `deepseek-v4-flash`

不要把 API Key 写进 `index.html`、`app.js` 或 GitHub 仓库。

当前 Worker 还包含：固定服务端模型、12 次/分钟客户端限流、请求体限制、上游超时、来源白名单、可选 Turnstile 服务端验证和 `/health` 健康检查。

> `TURNSTILE_SECRET_KEY` 暂时不要设置。它需要与正式域名对应的前端 Turnstile Sitekey 同时启用，否则所有 AI 请求都会被拒绝。
