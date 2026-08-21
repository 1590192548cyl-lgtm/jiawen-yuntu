const SILICONFLOW_URL = "https://api.siliconflow.cn/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_REQUEST_BYTES = 24_000;
const MAX_QUESTION_CHARS = 1_200;
const MAX_PROFILE_CHARS = 4_000;
const UPSTREAM_TIMEOUT_MS = 55_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!isOriginAllowed(request, env)) {
        return json({ error: "Origin is not allowed" }, 403, request, env);
      }
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "jiawen-ai",
        model: env.MODEL_NAME || DEFAULT_MODEL,
        searchEnabled: Boolean(env.TAVILY_API_KEY),
        abuseProtection: Boolean(env.AI_RATE_LIMITER)
      }, 200, request, env);
    }

    if (url.pathname !== "/" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, request, env);
    }

    if (!isOriginAllowed(request, env)) {
      return json({ error: "Origin is not allowed" }, 403, request, env);
    }

    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return json({ error: "Content-Type must be application/json" }, 415, request, env);
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_REQUEST_BYTES) {
      return json({ error: "Request body is too large" }, 413, request, env);
    }

    try {
      const body = await readJsonBody(request);
      const stream = body.stream === true;
      const question = extractUserQuestion(body).trim();
      const profile = normalizeProfile(body.profile);
      if (!question) {
        return json({ error: "Question is required" }, 400, request, env);
      }
      if (question.length > MAX_QUESTION_CHARS || profile.length > MAX_PROFILE_CHARS) {
        return json({ error: "Request content is too long" }, 413, request, env);
      }

      const rateLimitResult = await checkRateLimit(body.clientId, env);
      if (!rateLimitResult.success) {
        return json({ error: "请求过于频繁，请稍后再试。" }, 429, request, env, { "Retry-After": "60" });
      }

      const turnstileResult = await verifyTurnstile(body.turnstileToken, request, env);
      if (!turnstileResult.success) {
        return json({ error: "人机验证未通过，请刷新后重试。" }, 403, request, env);
      }

      const model = env.MODEL_NAME || DEFAULT_MODEL;
      const apiKey = env.MODEL_API_KEY || "";
      if (!apiKey) {
        return json({ error: "AI service is not configured" }, 503, request, env);
      }

      const apiBase = env.MODEL_API_BASE || SILICONFLOW_URL;
      const searchBundle = await maybeSearchWeb(question, env);
      if (searchBundle.results.length && shouldSearch(question)) {
        return json(searchOnlyResponse(question, searchBundle), 200, request, env);
      }
      const searchResults = searchBundle.results;
      const messages = normalizeMessages(question, profile, searchResults);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      const modelPayload = {
        model,
        messages,
        temperature: 0.4,
        max_tokens: Number(env.MODEL_MAX_TOKENS || 700),
        stream
      };
      if (model.startsWith("deepseek-v4")) {
        modelPayload.thinking = { type: "disabled" };
      }

      let upstream;
      try {
        upstream = await fetch(apiBase, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(modelPayload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!upstream.ok) {
        console.error("AI upstream error", upstream.status);
        return json({ error: "AI 服务暂时不可用，请稍后再试。" }, 502, request, env);
      }

      if (stream && upstream.body) {
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            ...corsHeaders(request, env)
          }
        });
      }

      const data = await upstream.json();
      tidyModelSources(data, searchResults);
      return json(data, 200, request, env);
    } catch (error) {
      if (error?.name === "AbortError") {
        return json({ error: "AI 服务响应超时，请稍后再试。" }, 504, request, env);
      }
      if (error?.message === "INVALID_JSON") {
        return json({ error: "Invalid JSON body" }, 400, request, env);
      }
      if (error?.name === "PayloadTooLargeError") {
        return json({ error: "Request body is too large" }, 413, request, env);
      }
      console.error("AI proxy failed", error?.message || error);
      return json({ error: "AI 服务暂时不可用，请稍后再试。" }, 500, request, env);
    }
  }
};

async function readJsonBody(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    const error = new Error("Request body is too large");
    error.name = "PayloadTooLargeError";
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error("INVALID_JSON");
  }
}

function normalizeProfile(profile) {
  if (!profile) return "用户尚未完成家庭建档。";
  return typeof profile === "string" ? profile : JSON.stringify(profile);
}

function normalizeMessages(message, profile, searchResults = []) {
  return withSearchContext([
    {
      role: "system",
      content: "你是家稳云图的家庭财务AI顾问。请用中文回答。你的服务范围包括家庭财务健康评估、现金流管理、风险缓冲、教育金、养老金、保障缺口分析，以及金融常识和政策规则解释。回答要简洁、可执行，并区分事实、假设与建议。只输出易读纯文本，不使用Markdown符号，包括星号、井号、代码围栏和列表横线；需要分点时使用‘1、’‘2、’。合规要求：不承诺收益、不代客理财、不预测短期走势、不推荐具体证券产品；涉及市场信息时注明‘仅供参考，市场有风险’。不要索取或复述身份证号、银行卡号、账户密码、详细住址等敏感信息。"
    },
    {
      role: "user",
      content: `家庭画像：${profile}\n用户问题：${message}`
    }
  ], searchResults);
}

async function checkRateLimit(clientId, env) {
  if (!env.AI_RATE_LIMITER) return { success: true };
  const normalizedId = typeof clientId === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(clientId)
    ? clientId
    : "anonymous-browser";
  return env.AI_RATE_LIMITER.limit({ key: normalizedId });
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return { success: true };
  if (typeof token !== "string" || !token || token.length > 2_048) return { success: false };

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") || undefined
    })
  });
  if (!response.ok) return { success: false };
  const result = await response.json();
  return { success: Boolean(result.success) };
}

function withSearchContext(messages, searchResults) {
  if (!searchResults.length) return messages;

  const context = searchResults.map((item, index) => {
    return `${index + 1}. ${item.title}\n站点: ${item.site}\n摘要: ${item.content}`;
  }).join("\n\n");

  return [
    ...messages,
    {
      role: "system",
      content: `以下是联网检索结果。回答涉及事实、政策、利率、市场动态或时效性信息时，优先依据这些资料；如果资料不足，请明确说明不确定。不要直接输出URL。回答末尾用“资料参考：”简要列出来源名称或站点，例如“央行官网、全国银行间同业拆借中心”，不要堆网址。\n\n${context}`
    }
  ];
}

function extractUserQuestion(body) {
  if (body.message) return String(body.message);
  if (Array.isArray(body.messages)) {
    const userMessage = [...body.messages].reverse().find((item) => item.role === "user");
    const content = userMessage?.content || "";
    const match = content.match(/用户问题：([\s\S]*)$/);
    return match ? match[1].trim() : content;
  }
  return "";
}

async function maybeSearchWeb(query, env) {
  if (!env.TAVILY_API_KEY || !shouldSearch(query)) return { answer: "", results: [] };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);
    const response = await fetch(TAVILY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query: `${query} 中文 官方 权威来源`,
        topic: inferSearchTopic(query),
        search_depth: "basic",
        max_results: 3,
        include_answer: true,
        include_raw_content: false,
        include_images: false
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) return { answer: "", results: [] };

    const data = await response.json();
    const results = (data.results || []).map((item) => ({
      title: item.title || "未命名来源",
      url: item.url || "",
      site: siteName(item.url),
      content: item.content || ""
    })).filter((item) => item.url && item.content);
    return { answer: data.answer || "", results };
  } catch (_) {
    return { answer: "", results: [] };
  }
}

function shouldSearch(query) {
  return /最新|今天|现在|目前|近期|新闻|政策|利率|LPR|市场|行情|走势|大盘|指数|纳斯达克|标普|道琼斯|恒生|A股|美股|港股|板块|涨跌|查询|搜索|资料|来源|法规|监管|202[0-9]|价格|汇率|基金|保险产品|黄金|原油|房价/.test(query);
}

function inferSearchTopic(query) {
  if (/新闻|今天|最新|近期/.test(query)) {
    return "news";
  }
  return "general";
}

function tidyModelSources(data, searchResults) {
  if (!searchResults.length) return;
  const message = data.choices?.[0]?.message;
  if (!message?.content) return;

  let content = message.content.replace(/https?:\/\/[^\s，。；、)）\]]+/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const sourceLine = compactSources(searchResults);
  if (/资料参考：|来源：/.test(content)) {
    content = content.replace(/(资料参考：|来源：)[\s\S]*$/g, sourceLine);
  } else {
    content = `${content}\n\n${sourceLine}`;
  }
  message.content = content;
}

function compactSources(searchResults) {
  const names = [];
  for (const item of searchResults) {
    const name = item.site || item.title;
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= 3) break;
  }
  return `资料参考：${names.join("、")}`;
}

function searchOnlyResponse(query, searchBundle) {
  const answer = buildSearchAnswer(query, searchBundle);
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: answer
        }
      }
    ]
  };
}

function buildSearchAnswer(query, searchBundle) {
  const sources = compactSources(searchBundle.results);
  const normalizedAnswer = cleanAnswer(searchBundle.answer || "");
  if (normalizedAnswer && mostlyChinese(normalizedAnswer)) {
    return `根据联网检索结果，${normalizedAnswer}\n\n${sources}`;
  }

  const points = searchBundle.results.slice(0, 3).map((item) => {
    return `- ${item.site || item.title}：${shorten(item.content, 95)}`;
  }).join("\n");

  return `我检索到了与“${query}”相关的资料。由于实时数据需要以官方发布为准，我先给你整理成中文摘要：\n${points}\n\n${sources}`;
}

function cleanAnswer(text) {
  return text
    .replace(/https?:\/\/[^\s，。；、)）\]]+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shorten(text, maxLength) {
  const value = cleanAnswer(text);
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function mostlyChinese(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  return chineseChars >= letters * 0.6;
}

function siteName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("pbc.gov.cn")) return "中国人民银行官网";
    if (host.includes("chinamoney.com.cn")) return "全国银行间同业拆借中心";
    if (host.includes("gov.cn")) return "中国政府网";
    if (host.includes("stats.gov.cn")) return "国家统计局";
    return host;
  } catch (_) {
    return "";
  }
}

function configuredOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = configuredOrigins(env);
  return !allowed.length || allowed.includes(origin);
}

function json(data, status = 200, request, env, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request, env),
      ...extraHeaders
    }
  });
}

function corsHeaders(request, env) {
  const origin = request?.headers.get("Origin") || "";
  const allowed = configuredOrigins(env || {});
  const allowOrigin = allowed.length ? (allowed.includes(origin) ? origin : "") : "*";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}
