const DEFAULT_AI_ENDPOINT = "https://jiawen-ai.1590192548cyl.workers.dev";
const DEFAULT_AI_MODEL = "deepseek-v4-flash";
const AI_CONFIG_KEY = "jiawen-ai-config-v2";
const AI_CLIENT_ID_KEY = "jiawen-ai-client-id-v1";
const OLD_DEFAULT_ENDPOINT = "https://holy-heart-40d2.1590192548cyl.workers.dev";
const OLD_DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct";
const PREVIOUS_PLATFORM_ENDPOINT = "https://jiawen-ai.jiangying10111222.workers.dev";

const state = {
  hasProfile: false,
  currentView: "welcome",
  history: [],
  profile: null,
  score: null,
  report: null,
  aiConfig: {
    endpoint: DEFAULT_AI_ENDPOINT,
    model: DEFAULT_AI_MODEL,
    apiKey: "",
    mode: "default"
  }
};

const labels = {
  protection: {
    full: "较完整",
    basic: "基础",
    weak: "不足",
    none: "缺口明显"
  },
  goal: {
    buffer: "建立风险缓冲",
    debt: "优化债务压力",
    education: "教育金储备",
    pension: "养老金规划",
    wealth: "稳健财富积累"
  },
  incomeSource: {
    salary: "稳定工薪收入",
    business: "个体经营/创业",
    freelance: "自由职业/兼职",
    investment: "投资性收入为主",
    mixed: "多源收入组合"
  },
  familySize: {
    solo: "1人",
    couple: "2人",
    three: "3人",
    four: "4人",
    "five-plus": "5人及以上"
  },
  childrenStage: {
    none: "暂无子女",
    preschool: "有学龄前子女",
    school: "有小学/中学在读子女",
    college: "有大学及以上在读子女",
    independent: "子女已独立"
  },
  elderlyCare: {
    none: "无赡养负担",
    light: "赡养1-2位老人",
    heavy: "赡养3位及以上老人",
    longterm: "需长期医疗照护"
  },
  investableAssets: {
    under10: "10万以下",
    mid10: "10-50万",
    mid50: "50-100万",
    over100: "100万以上"
  },
  financialLiteracy: {
    none: "暂无理财经验",
    basic: "初步了解存款理财",
    intermediate: "有一定基金/股票经验",
    advanced: "经验较丰富"
  }
};

function loadAIConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || "null");
    if (saved && typeof saved === "object") {
      const isStaleDefault = (
        saved.endpoint === OLD_DEFAULT_ENDPOINT && saved.model === OLD_DEFAULT_MODEL
      ) || (
        saved.mode === "default" && saved.endpoint === PREVIOUS_PLATFORM_ENDPOINT
      );
      if (!isStaleDefault) {
        state.aiConfig = {
          endpoint: DEFAULT_AI_ENDPOINT,
          model: DEFAULT_AI_MODEL,
          mode: "default",
          ...saved,
          apiKey: ""
        };
      }
    }
  } catch (_) {
    // 忽略损坏的本地配置，使用默认值
  }
}

function saveAIConfig() {
  try {
    const { apiKey: _sessionOnlyKey, ...safeConfig } = state.aiConfig;
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(safeConfig));
  } catch (_) {
    // 隐私模式下可能无法写入，忽略
  }
}

function getAIClientId() {
  try {
    const saved = localStorage.getItem(AI_CLIENT_ID_KEY);
    if (saved) return saved;
    const generated = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(AI_CLIENT_ID_KEY, generated);
    return generated;
  } catch (_) {
    return "anonymous-browser";
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function ratio(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function calculateRisk(profile) {
  const incomeScore = {
    stable: 16,
    normal: 12,
    unstable: 7,
    fragile: 4
  }[profile.incomeStability];

  const spendingRate = ratio(profile.expenses, profile.income);
  const debtRate = ratio(profile.debt, profile.income);
  const savingRate = ratio(profile.income - profile.expenses - profile.debt, profile.income);

  const spendingScore = clamp(18 - spendingRate * 24, 2, 18);
  const debtScore = clamp(18 - debtRate * 36, 2, 18);
  const emergencyScore = clamp(profile.emergency / 6 * 18, 1, 18);
  const protectionScore = {
    full: 16,
    basic: 11,
    weak: 7,
    none: 3
  }[profile.protection];
  const responsibilityScore = {
    light: 16,
    moderate: 12,
    heavy: 8,
    critical: 4
  }[profile.responsibility];

  const assetScore = {
    under10: 0,
    mid10: 1,
    mid50: 2,
    over100: 3
  }[profile.investableAssets] || 0;

  const rawScore = incomeScore + spendingScore + debtScore + emergencyScore + protectionScore + responsibilityScore + assetScore;
  const score = Math.round(clamp(rawScore, 0, 100));
  const level = score >= 85 ? "健康稳健" : score >= 70 ? "稳健关注" : score >= 55 ? "结构承压" : "高风险预警";
  const tone = score >= 70 ? "good" : score >= 55 ? "warn" : "danger";

  const weaknesses = [];
  if (profile.incomeStability === "unstable" || profile.incomeStability === "fragile") {
    weaknesses.push("收入稳定性不足，需要避免把长期支出建立在短期收入预期上。");
  }
  if (spendingRate > 0.55) {
    weaknesses.push("刚性支出占收入比例偏高，月度现金流弹性不足。");
  }
  if (debtRate > 0.35) {
    weaknesses.push("债务收入比偏高，建议优先梳理月供与还款节奏。");
  }
  if (profile.emergency < 3) {
    weaknesses.push("应急金覆盖不足三个月，面对失业或突发支出时缓冲偏薄。");
  }
  if (profile.protection === "weak" || profile.protection === "none") {
    weaknesses.push("基础保障存在缺口，疾病或意外风险可能放大家庭现金流压力。");
  }
  if (profile.responsibility === "heavy" || profile.responsibility === "critical") {
    weaknesses.push("家庭责任叠加明显，需要把育儿、赡养和住房压力放进同一张预算表。");
  }
  if (profile.elderlyCare === "longterm") {
    weaknesses.push("存在长期医疗照护负担，建议提前评估专项护理预算与保障安排。");
  }
  if (!weaknesses.length) {
    weaknesses.push("当前结构整体平衡，建议继续维持月度复盘和风险预警习惯。");
  }

  return {
    score,
    level,
    tone,
    spendingRate,
    debtRate,
    savingRate,
    weaknesses
  };
}

function getBufferPlan(profile, score) {
  const liquidityStatus = profile.emergency >= 6 ? "ok" : profile.emergency >= 3 ? "watch" : "risk";
  const debtStatus = score.debtRate <= 0.25 ? "ok" : score.debtRate <= 0.35 ? "watch" : "risk";
  const familyStatus = profile.responsibility === "light" || profile.responsibility === "moderate" ? "ok" : "watch";
  const hedgeStatus = profile.protection === "full" ? "ok" : profile.protection === "basic" ? "watch" : "risk";

  return [
    {
      title: "流动性缓冲层",
      status: liquidityStatus,
      text: profile.emergency >= 6
        ? "应急金覆盖已经达到稳健区间，继续保持高流动性资产独立存放。"
        : "优先把应急金补足至3-6个月刚性支出，先稳住家庭现金流底线。"
    },
    {
      title: "债务安全层",
      status: debtStatus,
      text: score.debtRate <= 0.35
        ? "当前债务收入比可控，建议保持月供、消费贷和信用卡账单同步复盘。"
        : "债务压力偏高，先评估提前还款、延长还款节奏或降低新增负债。"
    },
    {
      title: "代际互助层",
      status: familyStatus,
      text: profile.responsibility === "critical"
        ? "多项家庭责任叠加，建议建立家庭资金池规则并明确赡养、育儿预算边界。"
        : "家庭责任相对可管理，可用年度预算表固定教育、赡养和大额支出安排。"
    },
    {
      title: "风险对冲层",
      status: hedgeStatus,
      text: profile.protection === "full"
        ? "保障结构较完整，后续重点检查保额、免赔额和家庭成员覆盖一致性。"
        : "建议先补齐家庭主要收入来源成员的医疗、意外与基础寿险保障。"
    }
  ];
}

function generateReport(profile, score) {
  const bufferPlan = getBufferPlan(profile, score);
  const actions = [];

  if (profile.emergency < 6) {
    actions.push("把每月结余的30%-50%划入独立应急金账户，目标先达到3个月刚性支出。");
  }
  if (score.debtRate > 0.3 || profile.goal === "debt") {
    actions.push("列出所有债务的利率、期限和月供，优先处理高利率与短周期压力项。");
  }
  if (profile.protection !== "full") {
    actions.push("检查家庭主要收入成员保障缺口，优先补齐医疗、意外和基础寿险。");
  }
  if (profile.goal === "education") {
    actions.push("建立教育金目标表，拆分为年度储备金额和低波动资产配置区间。");
  }
  if (profile.goal === "pension") {
    actions.push("测算退休后基础支出，区分社保养老金、商业养老和长期储蓄来源。");
  }
  if (profile.childrenStage === "preschool" || profile.childrenStage === "school") {
    actions.push("按子女当前教育阶段测算未来教育金缺口，把月度储备固化进家庭预算。");
  }
  if (profile.elderlyCare === "longterm") {
    actions.push("为长期照护设置专项月度预算，评估护理类保障或家庭互助安排。");
  }
  if (profile.investableAssets === "mid50" || profile.investableAssets === "over100") {
    actions.push("对可投资资产做风险测评，按“应急-保障-稳健-长期”顺序配置，避免集中单一资产。");
  }
  if (!actions.length) {
    actions.push("保持每月一次家庭财务复盘，更新收入、支出、负债和保障变化。");
  }
  actions.push("与家庭成员共同确认本月预算边界，避免短期消费挤占长期目标。");

  return {
    summary: `当前家庭目标为“${labels.goal[profile.goal]}”，综合评分为${score.score}分，风险等级为“${score.level}”。建议先守住现金流安全底线，再推进财富积累和长期规划。`,
    bufferPlan,
    actions
  };
}

function profileBrief(profile) {
  if (!profile) return "用户尚未完成家庭建档。";
  return [
    `月收入${profile.income}元`,
    `月刚性支出${profile.expenses}元`,
    `月债务还款${profile.debt}元`,
    `应急金覆盖${profile.emergency}个月`,
    `家庭常住人口：${labels.familySize[profile.familySize] || profile.familySize}`,
    `主要收入来源：${labels.incomeSource[profile.incomeSource] || profile.incomeSource}`,
    `子女阶段：${labels.childrenStage[profile.childrenStage] || profile.childrenStage}`,
    `赡养负担：${labels.elderlyCare[profile.elderlyCare] || profile.elderlyCare}`,
    `收入稳定性：${profile.incomeStability}`,
    `保障：${profile.protection}`,
    `家庭责任：${profile.responsibility}`,
    `可投资资产：${labels.investableAssets[profile.investableAssets] || profile.investableAssets}`,
    `理财经验：${labels.financialLiteracy[profile.financialLiteracy] || profile.financialLiteracy}`,
    `目标：${labels.goal[profile.goal]}`
  ].join("；");
}

async function readStreamingReply(response, onChunk) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  const consumeEvent = (eventText) => {
    for (const line of eventText.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload);
        const chunk = data.choices?.[0]?.delta?.content || data.response || "";
        if (chunk) {
          reply += chunk;
          onChunk?.(reply);
        }
      } catch (_) {
        // Ignore provider keep-alive events and continue reading the stream.
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    events.forEach(consumeEvent);
    if (done) break;
  }
  if (buffer.trim()) consumeEvent(buffer);
  return reply;
}

async function callOpenSourceAgent(message, profile, onChunk) {
  const endpoint = state.aiConfig.endpoint.trim();
  const model = state.aiConfig.model.trim();
  const apiKey = (state.aiConfig.apiKey || "").trim();
  if (!endpoint || !model) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  const systemPrompt = "你是家稳云图的家庭财务AI顾问。请用中文回答。你的服务范围包括：家庭财务健康评估、现金流管理、风险缓冲、教育金、养老金、保障缺口分析，以及金融常识、市场动态、指数与宏观政策解读、产品规则解释。回答要简洁、可执行。只输出易读纯文本，不使用Markdown符号，包括星号、井号、代码围栏和列表横线；需要分点时使用“1、”“2、”。合规要求：不承诺收益、不代客理财、不预测短期走势、不推荐具体证券产品；解释市场动态时注明“仅供参考，市场有风险”。如果用户询问你的模型，可以说明你由家稳云图基于 DeepSeek-V4-Flash 提供支持。";
  const userPrompt = `家庭画像：${profileBrief(profile)}\n用户问题：${message}`;
  const conciseMessage = `${message}\n\n回答要求：除非我明确要求详细分析，否则请控制在220字以内，先给结论，最多列4点，不要重复介绍服务范围。`;
  const isOllama = endpoint.includes("/api/chat");
  const payload = state.aiConfig.mode === "default"
    ? {
        message: conciseMessage,
        profile: profileBrief(profile),
        clientId: getAIClientId(),
        stream: true
      }
    : isOllama
      ? {
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
        }
      : {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.4
      };

  try {
    const headers = { "Content-Type": "application/json" };
    if (state.aiConfig.mode === "custom" && apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      let detail = "";
      try {
        const errorData = await response.json();
        detail = errorData.error ? `：${errorData.error}` : "";
      } catch (_) {
        detail = "";
      }
      throw new Error(`AI接口返回 ${response.status}${detail}`);
    }
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      return await readStreamingReply(response, onChunk);
    }
    const data = await response.json();
    return data.message?.content || data.choices?.[0]?.message?.content || data.response || null;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("联网AI响应较慢");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function askAgent(message, profile, onChunk) {
  try {
    const agentReply = await callOpenSourceAgent(message, profile, onChunk);
    if (agentReply) return agentReply;
  } catch (error) {
    return `联网 AI 暂时没有返回（${error.message}）。你可以稍后再试，或到“AI 服务详情”中检查设置。下面先用本地规则给你一个兜底建议：${localRuleAgent(message, profile)}`;
  }

  return localRuleAgent(message, profile);
}

function localRuleAgent(message, profile) {
  if (!profile) {
    return "建议先完成家庭建档，再获得更准确的风险评分和行动清单。未建档前，我只能回答通用的家庭财务知识。";
  }

  const text = message.toLowerCase();
  const score = state.score || calculateRisk(profile);
  const monthlyGap = Math.max(profile.income - profile.expenses - profile.debt, 0);

  if (text.includes("预算") || text.includes("记账") || text.includes("储蓄") || text.includes("存钱") || text.includes("省钱")) {
    return `按你当前的画像，每月可调配结余约${monthlyGap.toLocaleString()}元。建议用“50-30-20”框架：刚性支出控制在50%以内、灵活消费约30%、储蓄投资至少20%，把储蓄部分先划入应急金和长期目标账户。`;
  }
  if (text.includes("失业") || text.includes("裁员") || text.includes("降薪") || text.includes("收入下降") || text.includes("断供")) {
    return `收入出现不确定性时，优先做三件事：一是把应急金补到至少3-6个月刚性支出；二是暂停非必要的大额支出和新增负债；三是与金融机构确认宽限期、展期等政策选项。你当前应急金覆盖${profile.emergency}个月，这是最需要加固的缓冲层。`;
  }
  if (text.includes("买车") || text.includes("车贷") || text.includes("装修") || text.includes("消费贷") || text.includes("提前还款")) {
    const rate = Math.round(score.debtRate * 100);
    return `你当前债务收入比约${rate}%。如果考虑买车/装修等大额支出，建议先做压力测试：新增月供后总债务收入比不要超过35%。提前还款优先处理利率高、期限短的债务，同时保留应急金不动。`;
  }
  if (text.includes("个税") || text.includes("税务") || text.includes("退税")) {
    return "个税优化可以从专项附加扣除入手：子女教育、继续教育、大病医疗、住房贷款利息、住房租金和赡养老人六项要核对是否都已填报。家庭收入和结构变化时，每年重新核对一次扣除项目。";
  }
  if (text.includes("买房") || text.includes("首付") || text.includes("换房")) {
    return `买房/换房规划建议分三步：先算总价与首付比例，再测月供占家庭收入比（不超过35%更稳妥），最后确认首付后仍保留3-6个月应急金。你当前月结余约${monthlyGap.toLocaleString()}元，可以先按这个节奏测算可承受的首付目标。`;
  }
  if (text.includes("生育") || text.includes("二胎") || text.includes("备孕") || text.includes("怀孕")) {
    return "备孕/二胎会增加刚性支出和收入中断风险，建议提前一年做三件事：补足应急金到6个月、把生育医疗支出列入预算、评估主要收入成员的保障是否覆盖孕产风险，再考虑教育金储备。";
  }
  if (text.includes("评分") || text.includes("体检") || text.includes("报告") || text.includes("画像")) {
    return `你的家庭财务健康分约${score.score}分，等级为“${score.level}”。主要短板和建议在“报告”页可以查看，也可以重新建档更新评分。`;
  }
  if (text.includes("应急") || text.includes("现金") || text.includes("流动")) {
    const target = Math.round((profile.expenses + profile.debt) * 3);
    return `建议先把应急金建立到至少3个月刚性支出，约${target.toLocaleString()}元；更稳健的目标是6个月。你当前覆盖${profile.emergency}个月，下一步可以把每月结余中的一部分自动转入独立账户。`;
  }
  if (text.includes("房贷") || text.includes("负债") || text.includes("债务") || text.includes("月供")) {
    return `你当前债务收入比约${Math.round(score.debtRate * 100)}%。若超过35%，优先减少新增消费贷和高息负债；若低于35%，重点是保持还款稳定，并预留利率或收入波动缓冲。`;
  }
  if (text.includes("教育")) {
    return "教育金建议用目标倒推法：先估算入学年份、年度支出和已有储备，再拆成每月定投或储蓄金额。资金属性要偏稳健，避免把短期教育支出暴露在高波动资产里。";
  }
  if (text.includes("养老") || text.includes("退休")) {
    return "养老金规划可以分三层：社保养老金保底、长期储蓄补充、商业养老或稳健投资增强。建议先测算退休后基础生活费，再倒推出每年需要补足的储备。";
  }
  if (text.includes("保险") || text.includes("保障") || text.includes("疾病") || text.includes("意外")) {
    return `当前保障完整度为“${labels.protection[profile.protection]}”。家庭优先级通常是主要收入成员的医疗、意外和基础寿险，其次再考虑老人、孩子和更高保额方案。`;
  }
  if (text.includes("收益") || text.includes("股票") || text.includes("基金") || text.includes("买什么")) {
    return "我可以帮你做风险匹配、资产配置框架和产品规则解释，但不会承诺收益或直接推荐具体证券产品。先确认应急金、负债和保障，再讨论可承受波动的长期资金比例。";
  }

  return `从你的家庭画像看，当前健康分约${score.score}分，月度可调配结余约${monthlyGap.toLocaleString()}元。建议按“建档-诊断-规划-执行-跟踪”推进：先补短板，再做长期目标配置。`;
}

function statusText(status) {
  return {
    ok: "稳健",
    watch: "关注",
    risk: "预警"
  }[status];
}

function renderBufferList(targetId, items) {
  const target = document.getElementById(targetId);
  target.innerHTML = items.map((item) => `
    <article class="buffer-item">
      <div>
        <strong>${item.title}</strong>
        <p>${item.text}</p>
      </div>
      <span class="status-pill ${item.status}">${statusText(item.status)}</span>
    </article>
  `).join("");
}

function renderList(targetId, items) {
  document.getElementById(targetId).innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function render() {
  document.getElementById("home-locked").hidden = state.hasProfile;
  document.getElementById("home-content").hidden = !state.hasProfile;
  document.getElementById("report-locked").hidden = state.hasProfile;
  document.getElementById("report-content").hidden = !state.hasProfile;

  if (!state.hasProfile || !state.profile) {
    return;
  }

  const profile = state.profile;
  state.score = calculateRisk(profile);
  state.report = generateReport(profile, state.score);

  const score = state.score;
  const report = state.report;
  const ringDegree = Math.round(score.score / 100 * 360);
  const ringColors = { good: "var(--green)", warn: "var(--amber)", danger: "var(--red)" };
  const ringColor = ringColors[score.tone] || "var(--green)";

  document.getElementById("health-score").textContent = score.score;
  document.getElementById("score-ring-value").textContent = score.score;
  document.querySelector(".score-ring").style.background = `conic-gradient(${ringColor} 0deg, ${ringColor} ${ringDegree}deg, rgba(255, 255, 255, 0.16) ${ringDegree}deg)`;

  const riskLabel = document.getElementById("risk-label");
  riskLabel.textContent = score.level;
  riskLabel.className = `risk-label ${score.tone}`;

  document.getElementById("saving-rate").textContent = `${Math.round(score.savingRate * 100)}%`;
  document.getElementById("debt-rate").textContent = `${Math.round(score.debtRate * 100)}%`;
  document.getElementById("emergency-cover").textContent = `${profile.emergency.toFixed(1)}月`;

  renderBufferList("home-buffer-list", report.bufferPlan);
  document.getElementById("report-score").textContent = score.score;
  document.getElementById("report-summary").textContent = report.summary;
  renderList("weakness-list", score.weaknesses);
  renderBufferList("report-buffer-list", report.bufferPlan);
  renderList("report-actions", report.actions);
}

function getProfileFromForm() {
  return {
    income: Number(document.getElementById("income").value) || 0,
    expenses: Number(document.getElementById("expenses").value) || 0,
    debt: Number(document.getElementById("debt").value) || 0,
    emergency: Number(document.getElementById("emergency").value) || 0,
    incomeSource: document.getElementById("income-source").value,
    familySize: document.getElementById("family-size").value,
    childrenStage: document.getElementById("children-stage").value,
    elderlyCare: document.getElementById("elderly-care").value,
    incomeStability: document.getElementById("income-stability").value,
    protection: document.getElementById("protection").value,
    responsibility: document.getElementById("responsibility").value,
    investableAssets: document.getElementById("investable-assets").value,
    financialLiteracy: document.getElementById("financial-literacy").value,
    goal: document.getElementById("goal").value
  };
}

function switchView(viewId, options = {}) {
  if (!options.skipHistory && state.currentView && state.currentView !== viewId) {
    state.history.push(state.currentView);
  }
  state.currentView = viewId;
  document.querySelector(".app-shell").classList.toggle("is-welcome", viewId === "welcome" || viewId === "demo");
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === viewId && button.closest(".bottom-nav"));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goBack() {
  const previousView = state.history.pop() || "welcome";
  switchView(previousView, { skipHistory: true });
}

function cleanAgentReply(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/(^|[\s（(])\*([^*\n]+)\*(?=$|[\s，。；、）)])/g, "$1$2")
    .replace(/^[\t ]*#{1,6}[\t ]*/gm, "")
    .replace(/^[\t ]*[-*][\t ]+/gm, "• ")
    .replace(/\*+/g, "")
    .replace(/[\t ]+(?=\d+[.、][\t ]+)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function addMessage(role, text) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.textContent = role === "agent" ? cleanAgentReply(text) : text;
  const log = document.getElementById("chat-log");
  log.appendChild(message);
  log.scrollTop = log.scrollHeight;
  return message;
}

function updateModelBadge() {
  const badge = document.getElementById("model-badge");
  if (!badge) return;
  const config = state.aiConfig;
  const friendlyNames = {
    "deepseek-v4-flash": "DeepSeek-V4-Flash",
    "deepseek-ai/DeepSeek-V3.2": "DeepSeek-V3.2",
    "deepseek-chat": "DeepSeek",
    "Qwen/Qwen2.5-7B-Instruct": "Qwen 2.5",
    "qwen2.5:3b": "Qwen 2.5（本地）"
  };
  const modelName = config.model || DEFAULT_AI_MODEL;
  const displayName = friendlyNames[modelName] || modelName;
  const modeLabel = config.mode === "custom" ? "我的服务" : "平台服务";
  badge.textContent = `AI 顾问：${displayName} · ${modeLabel}`;
}

function setAIStatus(text, stateName) {
  const indicator = document.getElementById("ai-status-indicator");
  if (!indicator) return;
  indicator.textContent = text;
  indicator.className = `pending${stateName ? ` ${stateName}` : ""}`;
}

function populateAIConfigForm() {
  const config = state.aiConfig;
  document.querySelector('input[name="ai-mode"][value="' + (config.mode === "custom" ? "custom" : "default") + '"]').checked = true;
  document.getElementById("ai-endpoint").value = config.endpoint || DEFAULT_AI_ENDPOINT;
  document.getElementById("ai-model").value = config.model || DEFAULT_AI_MODEL;
  document.getElementById("ai-key").value = config.apiKey || "";
}

function bindEvents() {
  document.getElementById("back-button").addEventListener("click", goBack);

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewTarget));
  });

  document.getElementById("profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.profile = getProfileFromForm();
    state.hasProfile = true;
    render();
    switchView("report");
  });

  document.getElementById("chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = document.getElementById("chat-message");
    const message = input.value.trim();
    const sendButton = form.querySelector("button[type='submit']");
    if (!message || form.dataset.busy === "1") return;
    form.dataset.busy = "1";
    sendButton.disabled = true;
    input.value = "";
    addMessage("user", message);
    const pending = addMessage("agent", "正在连接联网AI并分析，请稍等...");
    pending.classList.add("is-typing");
    try {
      const answer = await askAgent(message, state.profile, (partialReply) => {
        pending.textContent = cleanAgentReply(partialReply);
        pending.classList.remove("is-typing");
      });
      const reply = typeof answer === "string" ? answer : answer.reply || "已收到，我会结合家庭画像生成建议。";
      pending.textContent = cleanAgentReply(reply);
    } finally {
      pending.classList.remove("is-typing");
      sendButton.disabled = false;
      delete form.dataset.busy;
    }
  });

  document.getElementById("ai-config-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const mode = document.querySelector('input[name="ai-mode"]:checked').value;
    const endpoint = document.getElementById("ai-endpoint").value.trim();
    const model = document.getElementById("ai-model").value.trim();
    const apiKey = document.getElementById("ai-key").value.trim();
    const isLocalOllama = endpoint.includes("/api/chat");
    if (!endpoint || !model) {
      const status = document.getElementById("ai-config-status");
      status.textContent = "请填写服务地址和模型名称。";
      status.className = "settings-status error";
      return;
    }
    if (mode === "custom" && !apiKey && !isLocalOllama) {
      const status = document.getElementById("ai-config-status");
      status.textContent = "使用自己的模型服务需要填写密钥（本地模型可留空）。";
      status.className = "settings-status error";
      return;
    }
    state.aiConfig = { endpoint, model, apiKey, mode };
    saveAIConfig();
    updateModelBadge();
    const status = document.getElementById("ai-config-status");
    if (mode === "custom" && isLocalOllama) {
      status.textContent = "已启用本地模型服务，正在测试连接...";
    } else if (mode === "custom") {
      status.textContent = "已启用你自己的模型服务，正在测试连接...";
    } else {
      status.textContent = apiKey
        ? "已保存：平台 AI 服务 + 你的密钥。正在测试连接..."
        : "已保存：使用平台 AI 服务。正在测试连接...";
    }
    status.className = "settings-status";
    runConnectionTest();
  });

  document.getElementById("ai-test").addEventListener("click", runConnectionTest);

  document.getElementById("ai-reset").addEventListener("click", () => {
    state.aiConfig = {
      endpoint: DEFAULT_AI_ENDPOINT,
      model: DEFAULT_AI_MODEL,
      apiKey: "",
      mode: "default"
    };
    saveAIConfig();
    populateAIConfigForm();
    updateModelBadge();
    const status = document.getElementById("ai-config-status");
    status.textContent = "已恢复默认：平台 AI 服务（DeepSeek-V4-Flash）。";
    status.className = "settings-status ok";
    setAIStatus("待检测", "");
  });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("chat-message").value = button.dataset.prompt;
      document.getElementById("chat-form").requestSubmit();
    });
  });
}

async function runConnectionTest() {
  const button = document.getElementById("ai-test");
  const status = document.getElementById("ai-config-status");
  if (!button || !status) return;
  button.disabled = true;
  status.textContent = "正在测试连接，请稍候...";
  status.className = "settings-status";
  setAIStatus("检测中", "");
  try {
    const reply = await callOpenSourceAgent("你好，请用一句话简短回复。", state.profile);
    if (reply) {
      status.textContent = `连接成功，模型已回复：${String(reply).slice(0, 60)}...`;
      status.className = "settings-status ok";
      setAIStatus("正常", "ok");
    } else {
      status.textContent = "连接成功，但模型返回了空内容。";
      status.className = "settings-status error";
      setAIStatus("异常", "error");
    }
  } catch (error) {
    status.textContent = `连接失败：${error.message}。请检查服务地址与密钥是否正确，或稍后重试。`;
    status.className = "settings-status error";
    setAIStatus("异常", "error");
  } finally {
    button.disabled = false;
  }
}

loadAIConfig();
bindEvents();
populateAIConfigForm();
updateModelBadge();
render();
addMessage("agent", "你好，我是家稳云图 AI 顾问。可以先问我应急金、房贷压力、教育金、养老金或保障缺口。");
