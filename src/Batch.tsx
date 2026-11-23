import { useEffect, useRef, useState } from "react";
import { Bot, CheckCircle2, Play, Square, X, XCircle } from "lucide-react";
import { compareOutputs, runCpp, type RunResult } from "./runner";

export interface BatchItem {
  /** 第几段 C++（1 起） */
  no: number;
  code: string;
  stdin: string;
  expected: string;
}

type ItemState =
  | { s: "idle" }
  | { s: "running" }
  | { s: "done"; r: RunResult; verdict: boolean | null };

interface Props {
  items: BatchItem[];
  onClose(): void;
  onOpenRun(item: BatchItem): void;
  onAiAnalyze(item: BatchItem, r: RunResult, expected: string, actual: string): void;
}

const STAGE_LABEL: Record<RunResult["stage"], string> = {
  ok: "运行成功",
  compile: "编译错误",
  runtime: "运行时错误",
  timeout: "运行超时",
  network: "服务不可达",
};

function stateOf(it: ItemState | undefined, item: BatchItem): { label: string; cls: string } {
  if (!it || it.s === "idle") return { label: "待验证", cls: "" };
  if (it.s === "running") return { label: "运行中…", cls: "" };
  if (it.r.stage !== "ok") return { label: STAGE_LABEL[it.r.stage], cls: "bad" };
  if (item.expected.trim() && it.verdict === false) return { label: "答案不一致", cls: "bad" };
  return { label: item.expected.trim() ? "通过（与样例一致）" : "通过（无样例）", cls: "ok" };
}

export default function BatchDialog({ items, onClose, onOpenRun, onAiAnalyze }: Props) {
  const [states, setStates] = useState<Record<number, ItemState>>({});
  const [running, setRunning] = useState(false);
  const seq = useRef(0);

  const runAll = async () => {
    const my = ++seq.current;
    setRunning(true);
    setStates({});
    try {
      for (const item of items) {
        if (seq.current !== my) return;
        setStates((st) => ({ ...st, [item.no]: { s: "running" } }));
        const r = await runCpp(item.code, item.stdin);
        if (seq.current !== my) return;
        const verdict = r.stage === "ok" && item.expected.trim() ? compareOutputs(r.stdout, item.expected).match : null;
        setStates((st) => ({ ...st, [item.no]: { s: "done", r, verdict } }));
      }
    } finally {
      if (seq.current === my) setRunning(false);
    }
  };

  useEffect(() => {
    void runAll();
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = items.filter((i) => states[i.no]?.s === "done").length;
  const passCount = items.filter((i) => {
    const st = states[i.no];
    return st?.s === "done" && st.r.stage === "ok" && st.verdict !== false;
  }).length;

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dlg-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">逐段验证全文代码</div>
            <div className="modal-sub">
              文档里的 {items.length} 段 C++ 会带各自紧随的样例输入/期望输出逐个编译运行（在线 g++，需要联网）。
              {doneCount === items.length && !running ? ` 结果：${passCount}/${items.length} 通过。` : ""}
            </div>
          </div>
          <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="batch-list thin">
          {items.map((item) => {
            const st = states[item.no];
            const meta = stateOf(st, item);
            const failed = st?.s === "done" && (st.r.stage !== "ok" || st.verdict === false);
            return (
              <div key={item.no} className="batch-row">
                <span className="batch-no">第 {item.no} 段</span>
                <span className={"run-status " + meta.cls}>{failed ? <XCircle size={12} /> : meta.cls === "ok" ? <CheckCircle2 size={12} /> : null}{meta.label}</span>
                <span className="batch-hint">
                  {item.stdin.trim() ? "带样例输入" : "无输入"}
                  {item.expected.trim() ? " · 带期望输出" : ""}
                  {st?.s === "done" && st.r.timeMs !== undefined ? ` · ${st.r.timeMs} ms` : ""}
                </span>
                <span className="spacer" style={{ flex: 1 }} />
                {failed && st?.s === "done" && (
                  <button className="mini-btn" onClick={() => onAiAnalyze(item, (st as { r: RunResult }).r, item.expected, (st as { r: RunResult }).r.stdout)}>
                    <Bot size={11} />
                    AI 分析
                  </button>
                )}
                <button className="mini-btn" onClick={() => onOpenRun(item)}>
                  <Play size={11} />
                  打开运行框
                </button>
              </div>
            );
          })}
          {items.length === 0 && <div className="diagram-empty">文档里还没有 C++ 代码块。</div>}
        </div>

        <div className="modal-foot-actions">
          {running ? (
            <button className="bar-btn" onClick={() => { seq.current++; setRunning(false); }}>
              <Square size={12} />
              停止
            </button>
          ) : (
            <button className="bar-btn" onClick={() => void runAll()} disabled={items.length === 0}>
              <Play size={13} />
              重新验证
            </button>
          )}
          <button className="bar-btn accented" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
