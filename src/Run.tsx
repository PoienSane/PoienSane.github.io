import { useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, FileInput, Play, X, XCircle } from "lucide-react";
import { compareOutputs, runCpp, type RunResult } from "./runner";
import { diffLines, foldDiffRows, pairDiffRows, type DiffRow } from "./diff";
import { Segs } from "./Diff";
import UploadBtn from "./Upload";

interface Props {
  initialCode: string;
  initialStdin?: string;
  initialExpected?: string;
  /** 对拍模式：第二段代码（来自代码对比的 B 面），与 A 用同一份输入各跑一次比输出 */
  versusCode?: string;
  onClose(): void;
  /** 把运行输出作为代码块插回文档 */
  onInsertOutput(snippet: string): void;
  /** 对拍模式下转去多轮对拍（带生成器） */
  onStress?: (a: string, b: string) => void;
  /** 把代码、输入与失败结果交给 AI 分析 */
  onAiAnalyze?: (p: { code: string; stdin: string; result: RunResult; expected?: string; actual?: string; codeB?: string; resultB?: RunResult }) => void;
  /** 让 AI 根据代码造一组测试数据（结果回填 stdin） */
  onAiData?: (code: string) => void;
}

const STAGE_LABEL: Record<RunResult["stage"], string> = {
  ok: "运行成功",
  compile: "编译错误",
  runtime: "运行时错误",
  timeout: "运行超时",
  network: "服务不可达",
};

export function MiniDiff({ expected, actual }: { expected: string; actual: string }) {
  const rows = useMemo(() => foldDiffRows(pairDiffRows(diffLines(expected, actual)), 1).slice(0, 80), [expected, actual]);
  const render = (r: DiffRow | { kind: "gap"; count: number }, i: number) => {
    if (r.kind === "gap") return <div key={i} className="diff-gap">相同 {r.count} 行已折叠</div>;
    if (r.kind === "same")
      return (
        <div key={i} className="diff-row same">
          <span className="diff-no">{r.aNo}</span>
          <span className="diff-no">{r.bNo}</span>
          <span className="diff-text">{"  " + (r.text || "\u00A0")}</span>
        </div>
      );
    if (r.kind === "del")
      return (
        <div key={i} className="diff-row del">
          <span className="diff-no">{r.aNo}</span>
          <span className="diff-no" />
          <span className="diff-text">{"- " + (r.text || "\u00A0")}</span>
        </div>
      );
    if (r.kind === "add")
      return (
        <div key={i} className="diff-row add">
          <span className="diff-no" />
          <span className="diff-no">{r.bNo}</span>
          <span className="diff-text">{"+ " + (r.text || "\u00A0")}</span>
        </div>
      );
    return (
      <div key={i}>
        <div className="diff-row change-del">
          <span className="diff-no">{r.aNo}</span>
          <span className="diff-no" />
          <span className="diff-text">
            {"- "}
            <Segs segs={r.aSegs} side="del" />
          </span>
        </div>
        <div className="diff-row change-add">
          <span className="diff-no" />
          <span className="diff-no">{r.bNo}</span>
          <span className="diff-text">
            {"+ "}
            <Segs segs={r.bSegs} side="add" />
          </span>
        </div>
      </div>
    );
  };
  return <div className="diff-body thin run-diff">{rows.map(render)}</div>;
}

function OutBlock({ title, text, tone }: { title: string; text: string; tone?: "err" }) {
  if (!text) return null;
  return (
    <div className="run-block">
      <div className={"run-block-title" + (tone === "err" ? " err" : "")}>{title}</div>
      <pre className="run-out thin">{text}</pre>
    </div>
  );
}

function ResultPane({ label, r }: { label: string; r: RunResult }) {
  return (
    <div className="run-pane">
      <div className="run-pane-head">
        <span className="run-pane-name">{label}</span>
        <span className={"run-status " + (r.stage === "ok" ? "ok" : "bad")}>
          {r.stage === "ok" ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {STAGE_LABEL[r.stage]}
          {r.timeMs !== undefined && r.stage === "ok" ? ` · ${r.timeMs} ms` : ""}
        </span>
        <span className="run-provider">{r.provider}</span>
      </div>
      {r.message && <div className="diagram-hint">{r.message}</div>}
      <OutBlock title={r.stage === "compile" ? "编译日志" : "编译器提示"} text={r.compileLog} tone={r.stage === "compile" ? "err" : undefined} />
      <OutBlock title="标准输出" text={r.stdout} />
      <OutBlock title="标准错误" text={r.stderr} tone="err" />
      {r.stage !== "compile" && !r.stdout && !r.stderr && <div className="diagram-hint">（没有输出）</div>}
    </div>
  );
}

export default function RunDialog({ initialCode, initialStdin = "", initialExpected = "", versusCode, onClose, onInsertOutput, onStress, onAiAnalyze, onAiData }: Props) {
  const versus = versusCode !== undefined;
  const [code, setCode] = useState(initialCode);
  const [codeB, setCodeB] = useState(versusCode ?? "");
  const [stdin, setStdin] = useState(initialStdin);
  const [expected, setExpected] = useState(initialExpected);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [rA, setRA] = useState<RunResult | null>(null);
  const [rB, setRB] = useState<RunResult | null>(null);
  const seq = useRef(0);

  const verdict = useMemo(() => {
    if (!rA || rA.stage !== "ok") return null;
    if (versus) {
      if (!rB || rB.stage !== "ok") return null;
      return compareOutputs(rB.stdout, rA.stdout);
    }
    if (!expected.trim()) return null;
    return compareOutputs(rA.stdout, expected);
  }, [rA, rB, versus, expected]);

  const run = async () => {
    if (!code.trim()) {
      setErr("代码是空的。");
      return;
    }
    if (versus && !codeB.trim()) {
      setErr("对拍模式下 B 代码是空的。");
      return;
    }
    if (code.length > 100000 || codeB.length > 100000 || stdin.length > 100000) {
      setErr("代码或输入超过 100 KB，编译服务可能拒绝，请精简后再试。");
      return;
    }
    const my = ++seq.current;
    setRunning(true);
    setErr("");
    setRA(null);
    setRB(null);
    try {
      setStep(versus ? "正在编译运行 A…" : "正在编译运行…");
      const a = await runCpp(code, stdin);
      if (seq.current !== my) return;
      setRA(a);
      if (versus) {
        setStep("正在编译运行 B…");
        const b = await runCpp(codeB, stdin);
        if (seq.current !== my) return;
        setRB(b);
      }
    } finally {
      if (seq.current === my) {
        setRunning(false);
        setStep("");
      }
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dlg-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{versus ? "对拍运行（A/B 同输入）" : "编译运行 C++"}</div>
            <div className="modal-sub">
              代码会发送到在线编译服务（Judge0 · GCC 14 / Wandbox · GCC 13，-std=c++17 -O2）编译运行，需要联网；不要贴含密钥的代码。
            </div>
          </div>
          <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="diff-inputs">
          <label className="diff-lab">
            <span className="lab-row">
              {versus ? "代码 A" : "代码（C++）"}
              <UploadBtn onText={(t) => setCode(t)} />
            </span>
            <textarea className="diff-ta thin" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} rows={versus ? 8 : 10} placeholder="#include <bits/stdc++.h> …" />
          </label>
          {versus ? (
            <label className="diff-lab">
              <span className="lab-row">
                代码 B
                <UploadBtn onText={(t) => setCodeB(t)} />
              </span>
              <textarea className="diff-ta thin" value={codeB} onChange={(e) => setCodeB(e.target.value)} spellCheck={false} rows={8} placeholder="另一份实现" />
            </label>
          ) : (
            <div className="run-side">
              <label className="diff-lab">
                <span className="lab-row">
                  标准输入 stdin
                  <UploadBtn label="上传数据" onText={(t) => setStdin(t)} />
                </span>
                <textarea className="diff-ta thin" value={stdin} onChange={(e) => setStdin(e.target.value)} spellCheck={false} rows={4} placeholder={"样例输入，如\n3\n1 2 3"} />
              </label>
              <label className="diff-lab">
                <span className="lab-row">
                  期望输出（可选，填了自动对答案）
                  <UploadBtn label="上传答案" onText={(t) => setExpected(t)} />
                </span>
                <textarea className="diff-ta thin" value={expected} onChange={(e) => setExpected(e.target.value)} spellCheck={false} rows={4} placeholder="样例输出" />
              </label>
            </div>
          )}
        </div>
        {versus && (
          <div className="diff-inputs" style={{ paddingTop: 0 }}>
            <label className="diff-lab">
              <span className="lab-row">
                共同的标准输入 stdin（两段代码用同一份数据）
                <UploadBtn label="上传数据" onText={(t) => setStdin(t)} />
              </span>
              <textarea className="diff-ta thin" value={stdin} onChange={(e) => setStdin(e.target.value)} spellCheck={false} rows={3} placeholder="随机数据或样例输入" />
            </label>
          </div>
        )}

        <div className="diff-ctrl">
          <button className="bar-btn accented" onClick={() => void run()} disabled={running}>
            <Play size={13} />
            {running ? step || "运行中…" : versus ? "编译并对拍" : "编译并运行"}
          </button>
          {!versus && onAiData && (
            <button className="bar-btn tiny" onClick={() => onAiData(code)} title="让 AI 读这段代码，生成一组带边界情况的测试输入">
              AI 造测试数据
            </button>
          )}
          {versus && onStress && (
            <button className="bar-btn tiny" onClick={() => onStress(code, codeB)} title="带上这两段代码去多轮对拍，配生成器随机跑很多轮">
              改用多轮对拍
            </button>
          )}
          {err && <span className="diagram-err">{err}</span>}
          {!err && !running && <span className="diagram-hint">编译加运行一般要几秒；超时或沙箱限制会在结果里说明。</span>}
        </div>

        {(rA || rB) && (
          <div className="run-results thin">
            <div className={versus ? "run-cols" : undefined}>
              {rA && <ResultPane label={versus ? "A 的结果" : "运行结果"} r={rA} />}
              {versus && rB && <ResultPane label="B 的结果" r={rB} />}
            </div>
            {verdict && (
              <div className={"run-verdict " + (verdict.match ? "ok" : "bad")}>
                {verdict.match ? (
                  <>
                    <CheckCircle2 size={14} /> {versus ? "两段代码输出完全一致" : "输出与期望一致"}
                  </>) : (
                  <>
                    <XCircle size={14} /> {versus ? "两段代码输出不一致" : "输出与期望不一致"}
                    {verdict.firstDiff !== null ? `，第一处不同在第 ${verdict.firstDiff + 1} 行` : ""}
                  </>
                )}
              </div>
            )}
            {onAiAnalyze && rA && rA.stage !== "network" && (
              <div className="diff-ctrl" style={{ padding: "10px 0 0", flexWrap: "wrap" }}>
                <button className="bar-btn tiny" onClick={() => onAiAnalyze({ code, stdin, result: rA, expected: versus ? rB?.stdout : expected, actual: rA.stdout, codeB: versus ? codeB : undefined, resultB: versus ? rB ?? undefined : undefined })}>
                  <Bot size={12} />
                  {rA.stage !== "ok" ? `AI 分析${STAGE_LABEL[rA.stage]}` : verdict && !verdict.match ? "AI 分析答案不一致" : "AI 复核运行结果"}
                </button>
                {versus && rB && rB.stage !== "network" && (
                  <button className="bar-btn tiny" onClick={() => onAiAnalyze({ code: codeB, stdin, result: rB, expected: rA.stdout, actual: rB.stdout, codeB: code, resultB: rA })}>
                    <Bot size={12} /> AI 分析 B 与 A 的差异
                  </button>
                )}
                <span className="diagram-hint">将代码、输入、编译日志及输出一起交给 AI；答案不一致时同时提供期望输出。</span>
              </div>
            )}
            {verdict && !verdict.match && !versus && rA && <MiniDiff expected={expected} actual={rA.stdout} />}
            {verdict && !verdict.match && versus && rA && rB && <MiniDiff expected={rA.stdout} actual={rB.stdout} />}
          </div>
        )}

        <div className="modal-foot-actions">
          {!versus && (
            <button
              className="bar-btn"
              disabled={!rA || rA.stage !== "ok" || !rA.stdout}
              title="把标准输出作为一个文本代码块插回文档（在来源代码块后面）"
              onClick={() => {
                if (rA) onInsertOutput("```text\n" + rA.stdout.replace(/\n+$/, "") + "\n```");
              }}
            >
              <FileInput size={13} />
              插入输出到文档
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
