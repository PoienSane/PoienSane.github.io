import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ClipboardCopy, FileInput, Send, Settings2, Square, Wand2, X } from "lucide-react";
import { AI_PRESETS, AI_SYSTEM_PROMPT, FREE_AI_CONFIG, chatStream, clearAiConfig, loadAiConfig, normalizeBaseUrl, saveAiConfig, testAiConnection, type AiConfig, type ChatMessage } from "./ai";
import { renderMarkdown } from "./markdown";

export interface AiTask {
  title: string;
  /** 打开后自动发送的第一条消息（把代码/日志/反例都装在里面）；为空则不自动发送 */
  kickoff: string;
  /** 结果适合替换原选区（如润色）时为 true，插入按钮变成「替换选区」 */
  replaceSelection?: boolean;
  /** 附带当前文档全文作为上下文（AI 写作助手用） */
  docContext?: string;
}

interface Props {
  task?: AiTask | null;
  /** 一打开就停在设置页（如从「AI 设置」命令进入） */
  startWithSettings?: boolean;
  onClose(): void;
  onInsert(text: string, replaceSelection: boolean): void;
  /** 把回复回填给发起方（如用作运行输入、填入生成器），按钮文案由发起方定 */
  applyAction?: { label: string; run(text: string): void };
}

function SettingsForm({ initial, onSaved }: { initial: AiConfig | null; onSaved(c: AiConfig | null): void }) {
  const [mode, setMode] = useState<"free" | "custom">(initial ? "custom" : "free");
  const [presetId, setPresetId] = useState("deepseek");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? AI_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [model, setModel] = useState(initial?.model ?? AI_PRESETS[0].model);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = AI_PRESETS.find((x) => x.id === id);
    if (p && id !== "custom") {
      setBaseUrl(p.baseUrl);
      setModel(p.model);
    }
  };
  const current = (): AiConfig => ({ baseUrl: normalizeBaseUrl(baseUrl), apiKey: apiKey.trim(), model: model.trim() });

  return (
    <div className="ai-settings">
      <div className="seg" role="group" aria-label="AI 来源" style={{ marginBottom: 12 }}>
        <button className={mode === "free" ? "on" : ""} onClick={() => setMode("free")}>
          免费通道（免注册 / Key）
        </button>
        <button className={mode === "custom" ? "on" : ""} onClick={() => setMode("custom")}>
          用自己的 API Key
        </button>
      </div>
      {mode === "free" ? (
        <>
          <div className="diagram-hint" style={{ marginBottom: 10 }}>
            云端免费模型（Kilo Gateway），无需注册、不用填 Key，打开就能问。匿名免费模型按 IP 限流（官方标注约 200 次/小时）；自动从公开模型目录选择可用模型，优先代码与推理模型。共享网络可能共用额度，具体以服务端限流为准。
          </div>
          <button
            className="bar-btn accented"
            onClick={() => {
              clearAiConfig();
              onSaved(null);
            }}
          >
            <Check size={13} />
            使用免费 AI
          </button>
        </>
      ) : (
        <>
          <div className="diagram-hint" style={{ marginBottom: 10 }}>
            推荐 DeepSeek：platform.deepseek.com 注册后在「API Keys」新建一个，赠送额度够写很久。Key 只存在本机浏览器。
          </div>
          <div className="seg" style={{ flexWrap: "wrap", marginBottom: 12 }} role="group" aria-label="AI 服务商">
            {AI_PRESETS.map((p) => (
              <button key={p.id} className={presetId === p.id ? "on" : ""} onClick={() => applyPreset(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="ai-form">
            <label className="diff-lab">
              <span>接口地址 Base URL</span>
              <input className="ai-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" spellCheck={false} />
            </label>
            <label className="diff-lab">
              <span>模型 Model</span>
              <input className="ai-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" spellCheck={false} />
            </label>
            <label className="diff-lab">
              <span>API Key（本地 Ollama 可留空）</span>
              <input className="ai-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" spellCheck={false} autoComplete="off" />
            </label>
          </div>
          <div className="diff-ctrl" style={{ padding: "10px 0 0" }}>
            <button
              className="bar-btn"
              disabled={testing || !baseUrl.trim() || !model.trim()}
              onClick={async () => {
                setTesting(true);
                setTestMsg("正在连接…");
                try {
                  const reply = await testAiConnection(current());
                  setTestMsg("连接成功，AI 回复：" + reply);
                } catch (e) {
                  setTestMsg(e instanceof Error ? e.message : String(e));
                } finally {
                  setTesting(false);
                }
              }}
            >
              测试连接
            </button>
            <button
              className="bar-btn accented"
              disabled={!baseUrl.trim() || !model.trim()}
              onClick={() => {
                const c = current();
                saveAiConfig(c);
                onSaved(c);
              }}
            >
              <Check size={13} />
              保存并使用
            </button>
            {initial && (
              <button
                className="bar-btn"
                onClick={() => {
                  clearAiConfig();
                  onSaved(null);
                }}
              >
                切回免费 AI
              </button>
            )}
            {testMsg && <span className="diagram-hint">{testMsg}</span>}
          </div>
          <div className="diagram-hint">{AI_PRESETS.find((p) => p.id === presetId)?.hint}</div>
        </>
      )}
    </div>
  );
}

export default function AiDialog({ task, startWithSettings, onClose, onInsert, applyAction }: Props) {
  const [userCfg, setUserCfg] = useState<AiConfig | null>(() => loadAiConfig());
  const cfg = userCfg ?? FREE_AI_CONFIG;
  const isFree = !userCfg;
  const [showSettings, setShowSettings] = useState(!!startWithSettings);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const kickedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const renderedAssistant = useMemo(
    () => messages.map((m) => (m.role === "assistant" ? renderMarkdown(m.content).html : "")),
    [messages],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setError("");
    setInput("");
    const ctl0 = new AbortController();
    abortRef.current = ctl0;
    if (isFree) setError("");
    const system = AI_SYSTEM_PROMPT + (task?.docContext ? `\n\n【用户当前的文档全文（节选），回答时结合它】\n${task.docContext}` : "");
    const history: ChatMessage[] = [{ role: "system", content: system }, ...messages, { role: "user", content }];
    setMessages((ms) => [...ms, { role: "user", content }, { role: "assistant", content: "" }]);
    setBusy(true);
    const ctl = ctl0;
    try {
      await chatStream(cfg, history, (full) => {
        setMessages((ms) => {
          const next = [...ms];
          next[next.length - 1] = { role: "assistant", content: full };
          return next;
        });
      }, ctl.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
        setMessages((ms) => ms.filter((_, i) => !(i === ms.length - 1 && ms[i].role === "assistant" && !ms[i].content)));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (task?.kickoff && !kickedRef.current) {
      kickedRef.current = true;
      void send(task.kickoff);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dlg-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Bot size={16} />
              {task?.title ?? "AI 助手"}
            </div>
            <div className="modal-sub">
              {isFree ? "免费通道（免注册 / Key）· Kilo Gateway 自动选模型" : `自备 Key · ${cfg.model}（${normalizeBaseUrl(cfg.baseUrl)}）`}
              {task?.docContext ? " · 已带入当前文档" : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="bar-btn tiny" onClick={() => setShowSettings((v) => !v)} title="AI 设置：免费 AI 或自备 Key">
              <Settings2 size={14} />
              设置
            </button>
            <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
              <X size={15} />
            </button>
          </div>
        </div>

        {showSettings ? (
          <div style={{ padding: "14px 18px" }}>
            <SettingsForm
              initial={userCfg}
              onSaved={(c) => {
                setUserCfg(c);
                setShowSettings(false);
              }}
            />
          </div>
        ) : (
          <>
            <div className="ai-body thin" ref={scrollRef}>
              {messages.length === 0 && (
                <div className="diagram-empty" style={{ minHeight: 160 }}>
                  默认使用免费匿名模型（免注册 / Key，模型自动选择）；若公共额度暂时耗尽，可在设置中切换其他服务商。
                  <br />
                  可以让我：讲解代码、润色题解、根据报错找 bug、写数据生成器。命令面板（Ctrl+Shift+P）里还有「AI 润色选中文字」「AI 讲解选中代码」「AI 带着全文提问」。
                </div>
              )}
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="ai-msg user">
                    <div className="ai-bubble">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="ai-msg assistant">
                    <div className="ai-bubble md ai-md" dangerouslySetInnerHTML={{ __html: renderedAssistant[i] || "<p>思考中…</p>" }} />
                    {m.content && !busy && (
                      <div className="ai-actions">
                        <button className="mini-btn" onClick={() => void navigator.clipboard?.writeText(m.content)}>
                          <ClipboardCopy size={11} />
                          复制
                        </button>
                        <button className="mini-btn" onClick={() => onInsert(m.content, !!task?.replaceSelection)}>
                          <FileInput size={11} />
                          {task?.replaceSelection ? "替换选区" : "插入到文档"}
                        </button>
                        {applyAction && (
                          <button className="mini-btn" onClick={() => applyAction.run(m.content)}>
                            <Wand2 size={11} />
                            {applyAction.label}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ),
              )}
              {busy && <div className="diagram-hint" style={{ padding: "4px 2px" }}>AI 正在输出…（免费通道人多时稍慢，点停止可中断）</div>}
              {error && <div className="diagram-err" style={{ padding: "6px 2px" }}>{error}</div>}
            </div>
            <div className="ai-input-row">
              <textarea
                className="diff-ta thin"
                rows={3}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
              />
              {busy ? (
                <button className="bar-btn" onClick={() => abortRef.current?.abort()}>
                  <Square size={13} />
                  停止
                </button>
              ) : (
                <button className="bar-btn accented" onClick={() => void send(input)} disabled={!input.trim()}>
                  <Send size={13} />
                  发送
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
