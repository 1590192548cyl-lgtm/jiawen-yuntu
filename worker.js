const SILICONFLOW_URL = "https://api.siliconflow.cn/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_REQUEST_BYTES = 24_000;
const MAX_QUESTION_CHARS = 1_200;
const MAX_PROFILE_CHARS = 4_000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 8_000;
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
      const history = normalizeHistory(body.history);
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
      const searchQuery = resolveSearchQuery(question, history);
      const searchRequested = shouldSearch(searchQuery);
      const searchBundle = await maybeSearchWeb(searchQuery, env);
      const searchResults = searchBundle.results;
      const messages = normalizeMessages(question, profile, history, searchResults, searchRequested, searchQuery);
      const shouldStream = stream && !searchRequested;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      const modelPayload = {
        model,
        messages,
        temperature: searchRequested ? 0.2 : 0.4,
        max_tokens: Number(env.MODEL_MAX_TOKENS || 700),
        stream: shouldStream
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

      if (shouldStream && upstream.body) {
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
      tidyModelSources(data, searchResults, searchQuery);
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

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const normalized = [];
  let totalChars = 0;
  for (const item of history.slice(-MAX_HISTORY_MESSAGES)) {
    if (!item || !["user", "assistant"].includes(item.role)) continue;
    const content = String(item.content || "").trim().slice(0, 2_000);
    if (!content || totalChars + content.length > MAX_HISTORY_CHARS) continue;
    normalized.push({ role: item.role, content });
    totalChars += content.length;
  }
  return normalized;
}

function normalizeMessages(message, profile, history = [], searchResults = [], searchAttempted = false, searchQuery = "") {
  const messages = withSearchContext([
    {
      role: "system",
      content: "你是家稳云图的家庭财务AI顾问。请用中文回答。你的服务范围包括家庭财务健康评估、现金流管理、风险缓冲、教育金、养老金、保障缺口分析，以及金融常识和政策规则解释。必须结合对话历史理解‘具体说说’‘为什么’‘继续’等追问，不得丢失上一轮主题或突然重新介绍服务。用户在讨论市场时，除非主动询问个人配置，否则不要把话题转向家庭建档、教育金或养老金。先直接回答当前问题，再给依据；区分已核实事实、合理推断与建议。市场分析要说明日期和资料范围，资料不足时明确说无法核实，不编造点位、涨跌幅、板块表现或时效性结论。回答不超过4个分点，每点不超过2句，总长度尽量控制在450中文字以内；不要在每个分点重复相同的免责提醒，必须完整收尾。只输出易读纯文本，不使用Markdown符号，包括星号、井号、代码围栏和列表横线；需要分点时使用‘1、’‘2、’。合规要求：不承诺收益、不代客理财、不预测短期走势、不推荐具体证券产品；涉及市场信息时注明‘仅供参考，市场有风险’。不要索取或复述身份证号、银行卡号、账户密码、详细住址等敏感信息。"
    },
    ...history
  ], searchResults, searchAttempted, searchQuery);
  messages.push({
    role: "user",
    content: `家庭画像：${profile}\n用户问题：${message}`
  });
  return messages;
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

function withSearchContext(messages, searchResults, searchAttempted = false, searchQuery = "") {
  if (!searchResults.length) {
    if (!searchAttempted) return messages;
    return [
      ...messages,
      {
        role: "system",
        content: "本次联网检索没有返回足够可靠的资料。不要反问用户已经明确的话题，也不要重复上一轮原话；请直接说明信息边界，并结合当前问题给出有用的分析框架、判断方法或下一步。不得用模型记忆冒充当期点位和涨跌幅。"
      }
    ];
  }

  const context = searchResults.map((item, index) => {
    return `${index + 1}. ${item.title}\n站点: ${item.site}\n摘要: ${item.content}`;
  }).join("\n\n");
  const requestedDate = requestedRelativeDateLabel(searchQuery);
  const dateInstruction = requestedDate
    ? `用户所说的“上周五”指${requestedDate}。如果候选资料不是该日，也可以作为“最近可查资料”辅助分析，但必须清楚标注其实际日期，不得冒充${requestedDate}的行情。`
    : "";

  return [
    ...messages,
    {
      role: "system",
      content: `以下是本次联网检索到的候选资料，不是已经确认的事实。只能使用能从摘要中直接支持的内容，不得把无关页面、旧闻或跨市场资料当作当期A股事实，也不得用少数个股数据推断整个大盘涨跌或市场主线。${dateInstruction}先直接回答用户的问题，再交代资料日期和可验证范围；资料不能支持精确点位时，仍应给出基于已有资料的趋势、结构和风险分析，不要只回复“无法核实”。不要直接输出URL。回答末尾用“资料参考：”简要列出实际采用的来源名称或站点。\n\n${context}`
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

function resolveSearchQuery(question, history) {
  if (shouldSearch(question) || !isContextualFollowUp(question)) return question;
  const previousUserQuestion = [...history].reverse().find((item) => item.role === "user")?.content;
  return previousUserQuestion ? `${previousUserQuestion}\n追问：${question}` : question;
}

function isContextualFollowUp(question) {
  const compact = String(question || "").replace(/\s+/g, "");
  return compact.length <= 40 && /(具体|详细|展开|继续|为什么|怎么理解|怎么看|能多说|然后呢|这个|上述|前面|刚才|它)/.test(compact);
}

async function maybeSearchWeb(query, env) {
  if (!env.TAVILY_API_KEY || !shouldSearch(query)) return { answer: "", results: [] };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);
    const trustedDomains = trustedSearchDomains(query);
    const dateHint = resolveRelativeDateHint(query);
    const marketTerms = isMarketSearchQuery(query)
      ? "上证指数 深证成指 创业板指 两市成交额 上涨家数 板块涨跌"
      : "";
    const searchPayload = {
      query: `${currentChinaDate()} ${dateHint} ${query} ${marketTerms} 中文 收盘复盘 权威来源`.replace(/\s+/g, " ").trim(),
      topic: inferSearchTopic(query),
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false
    };
    if (isTimeSensitiveSearchQuery(query)) searchPayload.time_range = "week";
    if (trustedDomains.length) searchPayload.include_domains = trustedDomains;

    const response = await fetch(TAVILY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.TAVILY_API_KEY}`
      },
      body: JSON.stringify(searchPayload),
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

function currentChinaDate() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(new Date());
}

function resolveRelativeDateHint(query, now = new Date()) {
  const date = resolveRelativeDate(query, now);
  if (!date) return "";
  return `上周五具体日期 ${date.year}年${date.month}月${date.day}日`;
}

function requestedRelativeDateLabel(query) {
  const date = resolveRelativeDate(query);
  return date ? `${date.year}年${Number(date.month)}月${Number(date.day)}日` : "";
}

function resolveRelativeDate(query, now = new Date()) {
  if (!/上周五/.test(query)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const chinaDay = new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)));
  const daysSinceFriday = (chinaDay.getUTCDay() - 5 + 7) % 7 || 7;
  chinaDay.setUTCDate(chinaDay.getUTCDate() - daysSinceFriday);
  const year = chinaDay.getUTCFullYear();
  const month = String(chinaDay.getUTCMonth() + 1).padStart(2, "0");
  const day = String(chinaDay.getUTCDate()).padStart(2, "0");
  return { year, month, day };
}

function trustedSearchDomains(query) {
  if (!isMarketSearchQuery(query)) return [];
  return [
    "sse.com.cn",
    "szse.cn",
    "csrc.gov.cn",
    "pbc.gov.cn",
    "stats.gov.cn",
    "gov.cn",
    "xinhuanet.com",
    "cs.com.cn",
    "cnstock.com",
    "stcn.com",
    "cls.cn",
    "eastmoney.com",
    "finance.sina.com.cn"
  ];
}

function isMarketSearchQuery(query) {
  return /(行情|走势|大盘|指数|A股|沪深|板块|涨跌|股票|市场)/i.test(query);
}

function isTimeSensitiveSearchQuery(query) {
  return /(今天|现在|目前|最新|近期|上周|周五|收盘|盘中|实时)/.test(query);
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

function tidyModelSources(data, searchResults, searchQuery = "") {
  const message = data.choices?.[0]?.message;
  if (!message?.content) return;

  if (!searchResults.length) return;

  let content = message.content.replace(/https?:\/\/[^\s，。；、)）\]]+/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (isMarketSearchQuery(searchQuery)) {
    const asksForPersonalPlan = /(我的|持仓|账户|仓位|个人配置|家庭配置|怎么应对)/.test(searchQuery);
    const currentYear = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(new Date());
    const hasCurrentEvidence = searchResults.some((item) => `${item.title} ${item.content}`.includes(currentYear));
    content = content.split("\n").filter((line) => {
      if (!asksForPersonalPlan && /(家庭建档|完成建档|家庭画像|家庭财务|家庭情况|教育金|养老金)/.test(line)) return false;
      if (isTimeSensitiveSearchQuery(searchQuery) && /202[0-5]年/.test(line)) return false;
      return true;
    }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    let point = 0;
    content = content.replace(/^\d+、/gm, () => `${++point}、`);
    if (isTimeSensitiveSearchQuery(searchQuery) && !hasCurrentEvidence) {
      content = `我没有检索到足以核实最近交易日具体行情的当期权威数据，下面只提供分析框架。\n\n${content}`;
    }
  }
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
    const name = siteName(item.url) || item.site || item.title;
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= 3) break;
  }
  return `资料参考：${names.join("、")}`;
}

function siteName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("pbc.gov.cn")) return "中国人民银行官网";
    if (host.includes("sse.com.cn")) return "上交所官网";
    if (host.includes("szse.cn")) return "深交所官网";
    if (host.includes("csrc.gov.cn")) return "中国证监会官网";
    if (host.includes("cs.com.cn")) return "中国证券报";
    if (host.includes("cnstock.com")) return "上海证券报";
    if (host.includes("finance.sina.com.cn")) return "新浪财经";
    if (host.includes("eastmoney.com")) return "东方财富";
    if (host.includes("stcn.com")) return "证券时报";
    if (host.includes("cls.cn")) return "财联社";
    if (host.includes("xinhuanet.com")) return "新华网";
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
