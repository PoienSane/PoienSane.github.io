import { useRef, useState } from "react";
import { CheckCircle2, ClipboardCopy, FileInput, Play, Square, X, XCircle } from "lucide-react";
import { compareOutputs, runCpp, type RunResult } from "./runner";
import UploadBtn from "./Upload";
import { MiniDiff } from "./Run";

interface Props {
  initialGen: string;
  initialA: string;
  initialB: string;
  onClose(): void;
  /** 把反例（输入 + 两边输出）作为 Markdown 插回文档 */
  onInsert(snippet: string): void;
  /** 拿着反例去运行对话框里单步复现 */
  onOpenRun(init: { code: string; stdin: string; expected: string }): void;
  /** 把反例全套交给 AI 分析 */
  onAiAnalyze?: (info: { a: string; b: string; input: string; outA: string; outB: string }) => void;
  /** 让 AI 根据待测代码的输入格式写生成器（结果回填生成器框） */
  onAiGen?: (a: string, b: string) => void;
}

interface Failure {
  round: number;
  input: string;
  outA: string;
  outB: string;
  /** crash 时说明哪边什么阶段挂了；为空表示纯输出不一致 */
  crash?: string;
}

const ROUND_OPTIONS = [5, 10, 20, 30, 50];

export default function StressDialog({ initialGen, initialA, initialB, onClose, onInsert, onOpenRun, onAiAnalyze, onAiGen }: Props) {
  const [gen, setGen] = useState(initialGen);
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [rounds, setRounds] = useState(10);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [compileErr, setCompileErr] = useState<{ who: string; r: RunResult } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [passed, setPassed] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const seq = useRef(0);

  const stop = () => {
    seq.current++;
    setRunning(false);
    setStatus("已停止");
  };

  const run = async () => {
    if (!gen.trim() || !a.trim() || !b.trim()) {
      setErr("生成器、标程 A、待测 B 三段代码都要填。");
      return;
    }
    if (gen.length > 100000 || a.length > 100000 || b.length > 100000) {
      setErr("有代码超过 100 KB，请精简后再试。");
      return;
    }
    const my = ++seq.current;
    setRunning(true);
    setErr("");
    setCompileErr(null);
    setFailure(null);
    setPassed(null);
    setNote("");
    setDone(0);
    const seen = new Set<string>();
    let repeated = false;
    const alive = () => seq.current === my;
    try {
      for (let round = 1; round <= rounds; round++) {
        if (!alive()) return;
        setStatus(`第 ${round}/${rounds} 轮：生成数据…`);
        const g = await runCpp(gen, String(round));
        if (!alive()) return;
        if (g.stage === "compile") return setCompileErr({ who: "数据生成器", r: g });
        if (g.stage === "network") return setErr(g.message ?? "编译服务不可达");
        if (g.stage !== "ok") return setCompileErr({ who: `数据生成器（第 ${round} 轮${g.stage === "timeout" ? "超时" : "运行出错"}）`, r: g });
        const input = g.stdout;
        if (seen.has(input) && !repeated) {
          repeated = true;
          setNote("提醒：生成器连续产出相同数据，它可能没用上种子（种子由 stdin 第一行喂入），后面的轮次意义不大。");
        }
        seen.add(input);
        setStatus(`第 ${round}/${rounds} 轮：运行 A 与 B…`);
        const [ra, rb] = await Promise.all([runCpp(a, input), runCpp(b, input)]);
        if (!alive()) return;
        if (ra.stage === "compile") return setCompileErr({ who: "标程 A", r: ra });
        if (rb.stage === "compile") return setCompileErr({ who: "待测 B", r: rb });
        if (ra.stage === "network" || rb.stage === "network") return setErr((ra.stage === "network" ? ra : rb).message ?? "编译服务不可达");
        if (ra.stage !== "ok" || rb.stage !== "ok") {
          const bad = (r: RunResult, who: string) => (r.stage === "ok" ? "" : `${who} ${r.stage === "timeout" ? "超时" : "运行时出错"}`);
          setFailure({ round, input, outA: ra.stdout, outB: rb.stdout, crash: [bad(ra, "A"), bad(rb, "B")].filter(Boolean).join("；") });
          return;
        }
        const cmp = compareOutputs(rb.stdout, ra.stdout);
        if (!cmp.match) {
          setFailure({ round, input, outA: ra.stdout, outB: rb.stdout });
          return;
        }
        setDone(round);
      }
      setPassed(rounds);
      setStatus("");
    } finally {
      if (alive()) setRunning(false);
    }
  };

  const failureSnippet = failure
    ? [
        `**对拍反例（第 ${failure.round} 轮）**`,
        "",
        "输入：",
        "",
        "```text",
        failure.input.replace(/\n+$/, ""),
        "```",
        "",
        "标程 A 输出：",
        "",
        "```text",
        failure.outA.replace(/\n+$/, ""),
        "```",
        "",
        "待测 B 输出：",
        "",
        "```text",
        failure.outB.replace(/\n+$/, ""),
        "```",
      ].join("\n")
    : "";

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dlg-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">多轮对拍</div>
            <div className="modal-sub">
              生成器每轮从 stdin 读一个整数种子造数据，标程 A 与待测 B 用同一份数据各跑一次比输出；不一致立刻停并给出反例。编译走在线 g++，需要联网。
            </div>
          </div>
          <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="stress-grid">
          <label className="diff-lab">
            <span className="lab-row">
              数据生成器 gen（读种子）
              <span style={{ display: "flex", gap: 6 }}>
                {onAiGen && (
                  <button type="button" className="bar-btn tiny" onClick={() => onAiGen(a, b)} title="让 AI 按待测代码的输入格式写一个随机数据生成器">
                    AI 写生成器
                  </button>
                )}
                <UploadBtn onText={(t) => setGen(t)} />
              </span>
            </span>
            <textarea className="diff-ta thin" value={gen} onChange={(e) => setGen(e.target.value)} spellCheck={false} rows={7} placeholder="从 stdin 读种子，用 mt19937 造小数据" />
          </label>
          <label className="diff-lab">
            <span className="lab-row">
              标程 / 暴力 A（期望）
              <UploadBtn onText={(t) => setA(t)} />
            </span>
            <textarea className="diff-ta thin" value={a} onChange={(e) => setA(e.target.value)} spellCheck={false} rows={7} placeholder="正确但慢的实现" />
          </label>
          <label className="diff-lab">
            <span className="lab-row">
              待测 B
              <UploadBtn onText={(t) => setB(t)} />
            </span>
            <textarea className="diff-ta thin" value={b} onChange={(e) => setB(e.target.value)} spellCheck={false} rows={7} placeholder="要验证的实现" />
          </label>
        </div>

        <div className="diff-ctrl">
          <span className="diagram-hint">轮数</span>
          <div className="seg" role="group" aria-label="对拍轮数">
            {ROUND_OPTIONS.map((n) => (
              <button key={n} className={rounds === n ? "on" : ""} onClick={() => setRounds(n)} disabled={running}>
                {n}
              </button>
            ))}
          </div>
          {!running ? (
            <button className="bar-btn accented" onClick={() => void run()}>
              <Play size={13} />
              开始对拍
            </button>
          ) : (
            <button className="bar-btn" onClick={stop}>
              <Square size={12} />
              停止
            </button>
          )}
          <span className="diagram-hint">
            {running ? status : rounds > 20 ? "轮数越多越久，每轮约 2~4 秒" : "每轮约 2~4 秒（三段程序各跑一次）"}
          </span>
          <span className="spacer" />
          {running && (
            <span className="diff-stats">
              已通过 {done}/{rounds} 轮
            </span>
          )}
        </div>
        {running && (
          <div className="stress-bar" aria-hidden="true">
            <div style={{ width: `${(done / rounds) * 100}%` }} />
          </div>
        )}
        {err && <div className="diagram-err" style={{ padding: "8px 18px 0" }}>{err}</div>}
        {note && <div className="diagram-hint" style={{ padding: "8px 18px 0" }}>{note}</div>}

        {compileErr && (
          <div className="run-results thin" style={{ maxHeight: "30vh" }}>
            <div className="run-verdict bad">
              <XCircle size={14} /> {compileErr.who} 编译失败，先改好它再对拍
            </div>
            <pre className="run-out thin" style={{ marginTop: 8 }}>{compileErr.r.compileLog || compileErr.r.stderr || "（无日志）"}</pre>
          </div>
        )}

        {passed !== null && (
          <div className="run-results" style={{ maxHeight: "none" }}>
            <div className="run-verdict ok">
              <CheckCircle2 size={14} /> 全部 {passed} 轮对拍通过，A 与 B 输出一致
            </div>
          </div>
        )}

        {failure && (
          <div className="run-results thin">
            <div className="run-verdict bad">
              <XCircle size={14} /> 第 {failure.round} 轮对不上{failure.crash ? `（${failure.crash}）` : ""}，反例数据已锁定
            </div>
            <div className="run-cols" style={{ marginTop: 10 }}>
              <div className="run-block" style={{ marginTop: 0 }}>
                <div className="run-block-title">输入数据</div>
                <pre className="run-out thin">{failure.input}</pre>
              </div>
              <div className="run-block" style={{ marginTop: 0 }}>
                <div className="run-block-title">输出对比（- A 期望 / + B 实际）</div>
                <MiniDiff expected={failure.outA} actual={failure.outB} />
              </div>
            </div>
            <div className="diff-ctrl" style={{ padding: "10px 0 0" }}>
              <button
                className="bar-btn tiny"
                onClick={() => void navigator.clipboard?.writeText(failure.input)}
                title="把这组反例输入复制下来"
              >
                <ClipboardCopy size={12} />
                复制输入
              </button>
              <button
                className="bar-btn tiny"
                onClick={() => onOpenRun({ code: b, stdin: failure.input, expected: failure.outA })}
                title="在运行对话框里用这组数据单步跑 B，对着 A 的输出查"
              >
                <Play size={12} />
                用 B 复现
              </button>
              {onAiAnalyze && (
                <button
                  className="bar-btn tiny"
                  onClick={() => onAiAnalyze({ a, b, input: failure.input, outA: failure.outA, outB: failure.outB })}
                  title="把两段代码与这组反例发给 AI，分析 B 可能错在哪"
                >
                  AI 分析反例
                </button>
              )}
              <button
                className="bar-btn tiny"
                onClick={() => onInsert(failureSnippet)}
                title="把输入与两边输出写进文档存档"
              >
                <FileInput size={12} />
                插入反例到文档
              </button>
            </div>
          </div>
        )}

        <div className="modal-foot-actions">
          <button className="bar-btn accented" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
