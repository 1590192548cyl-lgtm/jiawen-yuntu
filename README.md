# 家稳云图

中国家庭风险缓冲与 AI 理财服务平台静态 MVP。

## 本地预览

直接打开 `index.html`，或在项目目录启动静态服务器：

```powershell
python -m http.server 5173
```

## GitHub Pages 部署

1. 新建一个公开仓库。
2. 上传本项目所有文件到仓库根目录。
3. 进入仓库 `Settings` -> `Pages`。
4. Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`。
6. 保存后等待 1-2 分钟，即可获得公网访问链接。

## 说明

当前版本是纯前端静态 MVP，不保存真实用户数据。

## 开源 AI 模型接入

AI 顾问默认由 **DeepSeek-V3.2** 大模型驱动（经 Cloudflare Worker 代理调用硅基流动），问答费用由项目方承担。

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

## Cloudflare Worker 代理（当前已部署）

本项目已部署 Worker：`https://jiawen-ai.jiangying10111222.workers.dev`

如需在其他账号/环境重新部署：

1. 在 Cloudflare 创建 Worker。
2. 将本仓库的 `worker.js` 复制到 Worker 编辑器。
3. 在 Worker 的环境变量中添加：
   - 变量名：`MODEL_API_KEY`
   - 变量值：你的模型服务商 API Key（默认为硅基流动）
   - 变量名：`MODEL_API_BASE`（可选，用于切换服务商）
   - 变量值：如 `https://api.deepseek.com/v1/chat/completions`、`https://api.moonshot.cn/v1/chat/completions` 等 OpenAI 兼容地址；不填则使用硅基流动
4. 如需联网搜索，再添加 Tavily 搜索 API Key：
   - 变量名：`TAVILY_API_KEY`
   - 变量值：你的 Tavily API Key
5. 部署 Worker，得到类似 `https://xxx.workers.dev` 的地址。
6. 在 `app.js` 中确认默认值：
   - `DEFAULT_AI_ENDPOINT` 为你的 Worker 地址
   - `DEFAULT_AI_MODEL` 为 `deepseek-ai/DeepSeek-V3.2`

不要把 API Key 写进 `index.html`、`app.js` 或 GitHub 仓库。
