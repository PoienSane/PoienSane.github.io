/**
 * AI 接入层：OpenAI 兼容的对话接口（DeepSeek / Kimi / 智谱 / OpenAI / 硅基流动 / 本地 Ollama 等）。
 * API Key 只存在浏览器 localStorage，请求由浏览器直连服务商，不经过任何中转。
 * SSE 流解析、请求组装是纯函数，方便测试；网络部分单独走 chatStream。
 */

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiPreset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hint: string;
}

export const AI_PRESETS: AiPreset[] = [
  { id: "deepseek", name: "DeepSeek（推荐）", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", hint: "platform.deepseek.com 注册后在 API Keys 新建，赠送额度够写很久题解" },
  { id: "glm", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", hint: "open.bigmodel.cn 新户送 2000 万免费 tokens" },
  { id: "siliconflow", name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", hint: "cloud.siliconflow.cn 新户送 2000 万 tokens" },
  { id: "groq", name: "Groq 免费层", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", hint: "console.groq.com 免费生成 Key，速度极快" },
  { id: "aistudio", name: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash", hint: "Google AI Studio 免费 Key 用 Gemini" },
  { id: "custom", name: "自定义 / 本地", baseUrl: "http://localhost:11434/v1", model: "qwen2.5", hint: "任意 OpenAI 兼容接口（Ollama、LM Studio、内网代理）" },
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const LS_KEY = "moxu:ai-config";

/** 默认匿名 AI：通过 Kilo Gateway 尝试调用公开免费模型，无需账号 / Key；可用性与额度由服务端决定。 */
export const FREE_AI_CONFIG: AiConfig = {
  baseUrl: "https://ai-gateway.kilo.ai/api/v1",
  apiKey: "",
  model: "minimax/minimax-m2.1:free",
};

const KILO_MODELS_URL = "https://ai-gateway.kilo.ai/api/v1/models";
let kiloModelCache: { at: number; model: string } | null = null;

/** 从公开模型目录挑选标记为 free 的模型；目录不可用时使用已知默认值。服务端仍可能限流或调整模型。 */
export async function resolveFreeModel(): Promise<string> {
  if (kiloModelCache && Date.now() - kiloModelCache.at < 10 * 60_000) return kiloModelCache.model;
  try {
    const res = await fetch(KILO_MODELS_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? []).map((x) => x.id ?? "").filter((id) => id.endsWith(":free"));
    const preference = [/deepseek/i, /qwen/i, /minimax/i, /glm/i, /nemotron/i, /gemma/i, /llama/i];
    const model = preference.map((re) => ids.find((id) => re.test(id))).find(Boolean) ?? ids[0];
    if (model) {
      kiloModelCache = { at: Date.now(), model };
      return model;
    }
  } catch { /* 使用稳定兜底模型 */ }
  return FREE_AI_CONFIG.model;
}

/** 当前生效的配置：自备 Key 优先，否则免费 AI */
export function effectiveAiConfig(): AiConfig {
  return loadAiConfig() ?? FREE_AI_CONFIG;
}

export function clearAiConfig(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 把 AI 回复里的代码围栏剥掉，只留代码/数据本身（造数据、写生成器时用） */
export function stripCodeFence(text: string): string {
  const m = /```[\w+-]*\n([\s\S]*?)(?:```|$)/.exec(text);
  return (m ? m[1] : text).trim();
}

export function loadAiConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<AiConfig>;
    if (!c.baseUrl || !c.model) return null;
    return { baseUrl: c.baseUrl, apiKey: c.apiKey ?? "", model: c.model };
  } catch {
    return null;
  }
}

export function saveAiConfig(c: AiConfig): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(c));
  } catch {
    /* 隐私模式等情况下存不下就算了 */
  }
}

export function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

export function buildChatBody(cfg: AiConfig, messages: ChatMessage[]): Record<string, unknown> {
  return { model: cfg.model, messages, stream: true, temperature: 0.6 };
}

/** 从一条 SSE data 行里取增量文本；不是内容行时返回 null */
export function sseDelta(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith("data:")) return null;
  const data = t.slice(5).trim();
  if (data === "[DONE]") return null;
  try {
    const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
    return j.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

/** 可测试的 SSE 累积器：喂任意分片文本，吐出拼好的全文 */
export function createSseAccumulator() {
  let buf = "";
  let text = "";
  return {
    feed(chunk: string): string {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const d = sseDelta(line);
        if (d) text += d;
      }
      return text;
    },
    text: () => text,
  };
}

function friendlyHttpError(status: number, body: string, hasKey: boolean): Error {
  if (!hasKey && [401, 402, 403, 429].includes(status)) {
    return new Error("免费 AI 通道暂时达到匿名额度（按 IP 限流，共享网络可能共用额度）。稍后重试，或在设置中切换自己的 API 服务。");
  }
  if (status === 401 || status === 403) return new Error("API Key 不正确或没有权限（401），去 AI 设置里检查。");
  if (status === 404) return new Error("接口或模型不存在（404），检查接口地址与模型名。");
  if (status === 429) return new Error("请求太频繁或余额不足（429），稍后再试。");
  if (status >= 500) return new Error(`AI 服务暂时不可用（${status}），稍后再试。`);
  return new Error(`AI 请求失败（${status}）${body ? "：" + body.slice(0, 120) : ""}`);
}

/** 流式对话：每到一段新文本就回调 onText(全文)，结束返回全文 */
export async function chatStream(cfg: AiConfig, messages: ChatMessage[], onText: (full: string) => void, signal?: AbortSignal): Promise<string> {
  const isAnonymousKilo = !cfg.apiKey && cfg.baseUrl.includes("ai-gateway.kilo.ai");
  const activeCfg = isAnonymousKilo ? { ...cfg, model: await resolveFreeModel() } : cfg;
  const request = async (target: AiConfig): Promise<Response> => fetch(normalizeBaseUrl(target.baseUrl) + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: JSON.stringify(buildChatBody(target, messages)),
    signal,
  });

  let res: Response;
  try {
    res = await request(activeCfg);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (!isAnonymousKilo) throw new Error("连接 AI 服务失败：可能是网络问题，或该接口不支持浏览器跨域调用。换个服务商或检查地址。");
    // 主通道不可达时退回旧匿名通道；只在收到响应体之前切换，避免重复拼接半截回答。
    try {
      res = await request({ baseUrl: "https://text.pollinations.ai/openai", apiKey: "", model: "openai-fast" });
    } catch {
      throw new Error("免费 AI 主通道和备用通道都无法连接，请检查网络后重试。");
    }
  }
  if (!res.ok && isAnonymousKilo) {
    const status = res.status;
    const detail = await res.text().catch(() => "");
    try {
      res = await request({ baseUrl: "https://text.pollinations.ai/openai", apiKey: "", model: "openai-fast" });
    } catch {
      throw friendlyHttpError(status, detail, false);
    }
  }
  if (!res.ok) throw friendlyHttpError(res.status, await res.text().catch(() => ""), !!activeCfg.apiKey);
  // 有的服务商忽略 stream 参数、直接回一整段 JSON，这里兜底解析
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    const j = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    const full = j?.choices?.[0]?.message?.content ?? "";
    if (full) onText(full);
    return full;
  }
  if (!res.body) throw new Error("AI 服务没有返回内容流。");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const acc = createSseAccumulator();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(acc.feed(decoder.decode(value, { stream: true })));
  }
  return acc.text();
}

/** 设置页的「测试连接」：发一条最短消息，能回就说明通 */
export async function testAiConnection(cfg: AiConfig): Promise<string> {
  let full = "";
  await chatStream(cfg, [{ role: "user", content: "只回复两个字：在的" }], (t) => (full = t), AbortSignal.timeout(30000));
  return full.trim() || "（已连通，但回复为空）";
}

export const AI_SYSTEM_PROMPT =
  "你是「墨序」题解编辑器内置的 AI 助手，服务对象是写 OI/ACM 题解与刷题的人。回答用简体中文，Markdown 格式；代码放进带语言标注的代码块（如 ```cpp），公式用 $...$ 或 $$...$$。结论先行、言简意赅，不说套话；不确定的地方明确说不确定，不要编造。";
