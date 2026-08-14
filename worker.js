const SILICONFLOW_URL = "https://api.siliconflow.cn/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";
const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V3.2";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return json({ error: "Only POST is supported" }, 405);
    }

    try {
      const body = await request.json();
      const model = body.model || DEFAULT_MODEL;
      const clientKey = request.headers.get("x-api-key")?.trim();
      const apiKey = clientKey || env.MODEL_API_KEY || "";
      if (!apiKey) {
        return json({ error: "No API key configured: set MODEL_API_KEY or send x-api-key" }, 500);
      }
      // 兼容任意 OpenAI-format 模型服务商：
      // 设置环境变量 MODEL_API_BASE 即可切换（如 https://api.deepseek.com/v1/chat/completions）
      const apiBase = env.MODEL_API_BASE || SILICONFLOW_URL;
      const searchQuery = extractUserQuestion(body);
      const searchBundle = await maybeSearchWeb(searchQuery, env);
      if (searchBundle.results.length && shouldSearch(searchQuery)) {
        return json(searchOnlyResponse(searchQuery, searchBundle), 200);
      }
      const searchResults = searchBundle.results;
      const messages = normalizeMessages(body, searchResults);

      const upstream = await fetch(apiBase, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: body.temperature ?? 0.4,
          stream: false
        })
      });

      const data = await upstream.json();
      tidyModelSources(data, searchResults);
      return json(data, upstream.status);
    } catch (error) {
      return json({ error: error.message || "AI proxy failed" }, 500);
    }
  }
};

function normalizeMessages(body, searchResults = []) {
  if (Array.isArray(body.messages) && body.messages.length) {
    return withSearchContext(body.messages, searchResults);
  }

  const profile = body.profile ? JSON.stringify(body.profile) : "用户尚未完成家庭建档。";
  const message = body.message || "请给出家庭财务风险缓冲建议。";

  return withSearchContext([
    {
      role: "system",
      content: "你是家稳云图的家庭财务AI顾问。请用中文回答。你的服务范围包括：家庭财务健康评估、现金流管理、风险缓冲、教育金、养老金、保障缺口分析，以及金融常识、市场动态、指数与宏观政策解读、产品规则解释。回答要简洁、可执行。合规要求：不承诺收益、不代客理财、不预测短期走势、不推荐具体证券产品；解释市场动态时注明“仅供参考，市场有风险”。如果用户询问你的模型，可以说明你由家稳云图基于 DeepSeek-V3.2 提供支持。"
    },
    {
      role: "user",
      content: `家庭画像：${profile}\n用户问题：${message}`
    }
  ], searchResults);
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key"
  };
}
