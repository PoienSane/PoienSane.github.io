import { useMemo, useState } from "react";
import { Columns2, FileInput, FlaskConical, Rows3, X } from "lucide-react";
import { diffLines, diffToText, pairDiffRows, diffRowStats, foldDiffRows, type DiffRow, type WordSeg } from "./diff";
import UploadBtn from "./Upload";

interface Props {
  /** 文档里的第一段代码，默认放在左侧 */
  initialA: string;
  /** 右侧初始内容（版本对比时传当前文档） */
  initialB?: string;
  onClose(): void;
  onInsert(diffText: string): void;
  /** 对拍：把 A/B 两段代码交给运行对话框，用同一份输入各跑一次比输出 */
  onVersus?: (a: string, b: string) => void;
  /** 多轮对拍：把 A/B 交给对拍对话框，配生成器随机跑很多轮 */
  onStress?: (a: string, b: string) => void;
}

/** 词级高亮：改动过的词用更深的红/绿标出，一眼看出改在哪 */
export function Segs({ segs, side }: { segs: WordSeg[]; side: "del" | "add" }) {
  return (
    <>
      {segs.map((s, i) =>
        s.t === "same" ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark key={i} className={side === "del" ? "diff-wd" : "diff-wa"}>
            {s.text}
          </mark>
        ),
      )}
    </>
  );
}

export default function DiffDialog({ initialA, initialB = "", onClose, onInsert, onVersus, onStress }: Props) {
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [view, setView] = useState<"unified" | "side">("unified");
  const [fold, setFold] = useState(true);
  const tooBig = a.split("\n").length + b.split("\n").length > 3000;
  const ops = useMemo(() => (!tooBig && (a.trim() || b.trim()) ? diffLines(a, b) : []), [a, b, tooBig]);
  const rows = useMemo(() => pairDiffRows(ops), [ops]);
  const stats = useMemo(() => diffRowStats(rows), [rows]);
  const display = useMemo(() => (fold ? foldDiffRows(rows, 2) : rows), [rows, fold]);
  const hasGap = display.some((r) => r.kind === "gap");

  const renderUnifiedRow = (r: DiffRow | { kind: "gap"; count: number }, i: number) => {
    if (r.kind === "gap") {
      return (
        <div key={i} className="diff-gap">
          未改动 {r.count} 行已折叠
        </div>
      );
    }
    if (r.kind === "same") {
      return (
        <div key={i} className="diff-row same">
          <span className="diff-no">{r.aNo}</span>
          <span className="diff-no">{r.bNo}</span>
          <span className="diff-text">{"  " + (r.text || "\u00A0")}</span>
        </div>
      );
    }
    if (r.kind === "del") {
      return (
        <div key={i} className="diff-row del">
          <span className="diff-no">{r.aNo}</span>
          <span className="diff-no" />
          <span className="diff-text">{"- " + (r.text || "\u00A0")}</span>
        </div>
      );
    }
    if (r.kind === "add") {
      return (
        <div key={i} className="diff-row add">
          <span className="diff-no" />
          <span className="diff-no">{r.bNo}</span>
          <span className="diff-text">{"+ " + (r.text || "\u00A0")}</span>
        </div>
      );
    }
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

  const renderSideRow = (r: DiffRow | { kind: "gap"; count: number }, i: number) => {
    if (r.kind === "gap") {
      return (
        <div key={i} className="diff-srow">
          <div className="diff-gap diff-sgap">未改动 {r.count} 行已折叠</div>
        </div>
      );
    }
    if (r.kind === "same") {
      return (
        <div key={i} className="diff-srow">
          <span className="diff-sno">{r.aNo}</span>
          <span className="diff-scell">{r.text || "\u00A0"}</span>
          <span className="diff-sno">{r.bNo}</span>
          <span className="diff-scell">{r.text || "\u00A0"}</span>
        </div>
      );
    }
    if (r.kind === "change") {
      return (
        <div key={i} className="diff-srow">
          <span className="diff-sno">{r.aNo}</span>
          <span className="diff-scell del">
            <Segs segs={r.aSegs} side="del" />
            {r.aText === "" ? "\u00A0" : null}
          </span>
          <span className="diff-sno">{r.bNo}</span>
          <span className="diff-scell add">
            <Segs segs={r.bSegs} side="add" />
            {r.bText === "" ? "\u00A0" : null}
          </span>
        </div>
      );
    }
    if (r.kind === "del") {
      return (
        <div key={i} className="diff-srow">
          <span className="diff-sno">{r.aNo}</span>
          <span className="diff-scell del">{r.text || "\u00A0"}</span>
          <span className="diff-sno" />
          <span className="diff-scell none" />
        </div>
      );
    }
    return (
      <div key={i} className="diff-srow">
        <span className="diff-sno" />
        <span className="diff-scell none" />
        <span className="diff-sno">{r.bNo}</span>
        <span className="diff-scell add">{r.text || "\u00A0"}</span>
      </div>
    );
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dlg-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">代码对比</div>
            <div className="modal-sub">
              左侧默认是文档里的第一段代码，右侧粘贴新版本。绿色新增、红色删除；改动行会配成一对，并把改了的词描深。
              {rows.length > 0 && (
                <span className="diff-stats">
                  {" "}
                  +{stats.add} / -{stats.del} / 改 {stats.change} / 相同 {stats.same} 行
                </span>
              )}
            </div>
          </div>
          <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="diff-inputs">
          <label className="diff-lab">
            <span className="lab-row">
              旧代码 A
              <UploadBtn onText={(t) => setA(t)} />
            </span>
            <textarea className="diff-ta thin" value={a} onChange={(e) => setA(e.target.value)} spellCheck={false} rows={7} placeholder="旧版本代码" />
          </label>
          <label className="diff-lab">
            <span className="lab-row">
              新代码 B
              <UploadBtn onText={(t) => setB(t)} />
            </span>
            <textarea className="diff-ta thin" value={b} onChange={(e) => setB(e.target.value)} spellCheck={false} rows={7} placeholder="把新版本粘到这里" />
          </label>
        </div>

        {tooBig ? (
          <div className="diagram-err" style={{ padding: "12px 18px" }}>
            两段代码加起来超过 3000 行，已停止对比（LCS 是平方复杂度）。
          </div>
        ) : rows.length === 0 ? (
          <div className="diagram-empty" style={{ padding: "18px" }}>
            两侧都粘上代码后，这里会逐行标出差异。
          </div>
        ) : (
          <>
            <div className="diff-ctrl">
              <div className="seg" role="group" aria-label="对比视图">
                <button className={view === "unified" ? "on" : ""} onClick={() => setView("unified")}>
                  <Rows3 size={12} /> 统一
                </button>
                <button className={view === "side" ? "on" : ""} onClick={() => setView("side")}>
                  <Columns2 size={12} /> 并排
                </button>
              </div>
              <button className={"bar-btn tiny" + (fold ? " on" : "")} onClick={() => setFold((f) => !f)} title="把大段未改动的行折叠起来，只看改动附近">
                折叠相同行
              </button>
              <span className="spacer" />
              {fold && hasGap && <span className="diagram-hint">已折叠未改动大段，点「折叠相同行」可展开全部</span>}
            </div>
            {view === "unified" ? (
              <div className="diff-body thin">{display.map(renderUnifiedRow)}</div>
            ) : (
              <div className="diff-body thin">
                <div className="diff-sbs">{display.map(renderSideRow)}</div>
              </div>
            )}
          </>
        )}

        <div className="modal-foot-actions">
          {onVersus && (
            <button className="bar-btn" disabled={tooBig || !a.trim() || !b.trim()} onClick={() => onVersus(a, b)} title="用同一份输入分别编译运行 A 和 B，比较输出是否一致（对拍）">
              <FlaskConical size={13} />
              对拍运行
            </button>
          )}
          {onStress && (
            <button className="bar-btn" disabled={tooBig || !a.trim() || !b.trim()} onClick={() => onStress(a, b)} title="配一个随机数据生成器，让 A/B 自动跑很多轮找反例">
              <FlaskConical size={13} />
              多轮对拍
            </button>
          )}
          <button
            className="bar-btn accented"
            disabled={!ops.length || tooBig}
            onClick={() => {
              onInsert(diffToText(ops));
              onClose();
            }}
          >
            <FileInput size={13} />
            插入为 diff 代码块
          </button>
        </div>
      </div>
    </div>
  );
}
