import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCopy,
  Download,
  FileInput,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  StepBack,
  StepForward,
  X,
} from "lucide-react";
import {
  DIAGRAM_EXAMPLES,
  DIAGRAM_LABEL,
  buildDiagram,
  circleLayout,
  countCrossings,
  createVelocities,
  physicsStep,
  simulatePhysics,
  parseDotInput,
  parseGraphInput,
  parseTreeInput,
  renderGraphSvg,
  treeLayout,
  traverseOrder,
  type DiagramKind,
  type GEdge2,
  type PosMap,
  type Pt,
  type VelMap,
} from "./diagram";

interface Props {
  onClose(): void;
  onInsert(svg: string): void;
}

const KINDS: DiagramKind[] = ["tree", "graph", "segtree", "flow", "dp", "mermaid", "dot"];
const INTERACTIVE: DiagramKind[] = ["tree", "graph", "dot"];

const HINTS: Record<DiagramKind, string> = {
  tree: "每行一条边「父 子」；或一行层序数组（# 为空）：1 2 3 # 4。节点可拖动。",
  graph: "每行一条边「u v [权重]」。节点带真实物理：互相排斥、边像弹簧，拖动后会回弹，自动减少重叠。",
  segtree: "一串数字（最多 16 个），节点上是区间 [l, r] 与区间和，左上角圆点是节点编号（根为 1，左孩子 2p、右孩子 2p+1）。",
  flow: "每行一个步骤；以 ? 或 ？ 结尾的步骤画成判断菱形。",
  dp: "每行一个状态行，空格分隔；箭头从较大的前驱指向当前格。",
  mermaid: "Mermaid 子集：A[文本] 矩形、A{文本} 判断、A(文本) 圆；--> 连线，-->|注| 带标注。",
  dot: "Graphviz DOT 子集：digraph { A -> B [label=\"4\"] }，打开后会用物理布局自动散开。",
};

const GW = 660;
const GH = 470;

export default function DiagramDialog({ onClose, onInsert }: Props) {
  const [kind, setKind] = useState<DiagramKind>("graph");
  const [directed, setDirected] = useState(false);
  const [input, setInput] = useState(DIAGRAM_EXAMPLES.graph);
  const [note, setNote] = useState("");

  const interactive = INTERACTIVE.includes(kind);

  // ---------- 交互模型（树 / 图 / DOT） ----------
  const model = useMemo((): { nodes: string[]; edges: GEdge2[]; treeRoot: string; children: Map<string, string[]> | null } => {
    if (kind === "tree") {
      const t = parseTreeInput(input);
      return { nodes: t.nodes, edges: t.edges, treeRoot: t.root, children: t.children };
    }
    if (kind === "dot") {
      const d = parseDotInput(input);
      return { nodes: d.nodes, edges: d.edges, treeRoot: "", children: null };
    }
    const g = parseGraphInput(input);
    return { nodes: g.nodes, edges: g.edges, treeRoot: "", children: null };
  }, [kind, input]);

  const [pos, setPos] = useState<PosMap>(new Map());
  const [playing, setPlaying] = useState(true);
  const [physics, setPhysics] = useState({ repulsion: 100, spring: 100, rest: 118 });
  const [travMode, setTravMode] = useState<"bfs" | "dfs">("bfs");
  const [travAt, setTravAt] = useState(-1); // -1 表示未开始访问动画
  const [travPlaying, setTravPlaying] = useState(false);
  const dragRef = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const posRef = useRef<PosMap>(new Map());
  const velRef = useRef<VelMap>(new Map());
  const dragPointRef = useRef<Pt | null>(null);
  const dragVelRef = useRef<Pt>({ x: 0, y: 0 });
  const lastDragAtRef = useRef(0);
  const commitPos = (next: PosMap) => {
    posRef.current = next;
    setPos(next);
  };
  const modelRef = useRef(model);
  modelRef.current = model;
  const physicsRef = useRef(physics);
  physicsRef.current = physics;

  const treeSize = useMemo(() => {
    if (kind === "tree" && model.children) {
      const t = treeLayout(model.children, model.treeRoot);
      return { w: Math.max(360, t.w), h: Math.max(240, t.h) };
    }
    return { w: GW, h: GH };
  }, [kind, model]);

  const modelKey = useMemo(
    () => model.nodes.join("\u0001") + "|" + model.edges.map((e) => `${e.u}>${e.v}:${e.w}`).join("\u0002"),
    [model],
  );

  // 切换类型时初始化；编辑边时保留已拖好的节点位置，不再整图重置
  useEffect(() => {
    if (!interactive) return;
    setTravAt(-1);
    setTravPlaying(false);
    if (kind === "tree" && model.children) {
      commitPos(treeLayout(model.children, model.treeRoot).pos);
      velRef.current = createVelocities(model.nodes);
      setPlaying(false);
    } else {
      commitPos(circleLayout(model.nodes, GW, GH));
      velRef.current = createVelocities(model.nodes);
      setPlaying(true);
    }
    // 只在类型切换时重排，输入边变化由下面的 reconcile 增量处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, interactive]);

  // 增量同步节点：已有节点保持位置，新节点放到邻居附近，删除节点移除
  useEffect(() => {
    if (!interactive || kind === "tree") return;
    const prev = posRef.current;
    if (!prev.size) {
      if (model.nodes.length) {
        commitPos(circleLayout(model.nodes, GW, GH));
        velRef.current = createVelocities(model.nodes);
        setPlaying(true);
      }
      return;
    }
    const next: PosMap = new Map();
    model.nodes.forEach((id, i) => {
      const old = prev.get(id);
      if (old) {
        next.set(id, old);
        return;
      }
      const neighborPts = model.edges
        .filter((e) => e.u === id || e.v === id)
        .map((e) => prev.get(e.u === id ? e.v : e.u))
        .filter((p): p is Pt => !!p);
      if (neighborPts.length) {
        const cx = neighborPts.reduce((a, p) => a + p.x, 0) / neighborPts.length;
        const cy = neighborPts.reduce((a, p) => a + p.y, 0) / neighborPts.length;
        const ang = i * 2.399;
        next.set(id, { x: Math.min(GW - 24, Math.max(24, cx + Math.cos(ang) * 54)), y: Math.min(GH - 24, Math.max(24, cy + Math.sin(ang) * 54)) });
      } else {
        const ang = (i / Math.max(1, model.nodes.length)) * Math.PI * 2 - Math.PI / 2;
        next.set(id, { x: GW / 2 + Math.cos(ang) * 120, y: GH / 2 + Math.sin(ang) * 92 });
      }
    });
    velRef.current = new Map(model.nodes.map((id) => [id, velRef.current.get(id) ?? { x: 0, y: 0 }]));
    commitPos(next);
    if (model.nodes.length) setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, interactive, kind]);

  // 树结构变化时重排（树仍用层级布局，不套用图物理）
  useEffect(() => {
    if (kind !== "tree" || !model.children) return;
    commitPos(treeLayout(model.children, model.treeRoot).pos);
    velRef.current = createVelocities(model.nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, modelKey]);

  // DOT 的有向性跟随输入
  useEffect(() => {
    if (kind === "dot") setDirected(parseDotInput(input).directed);
  }, [kind, input]);

  // 真实物理动画：斥力、边弹簧、碰撞与惯性；停稳后自动暂停省电
  useEffect(() => {
    if (!playing || kind === "tree" || !interactive) return;
    let raf = 0;
    let stableFrames = 0;
    const tick = () => {
      const m = modelRef.current;
      const cfg = physicsRef.current;
      const out = physicsStep(
        posRef.current,
        velRef.current,
        m.edges,
        GW,
        GH,
        { repulsion: cfg.repulsion / 100, spring: cfg.spring / 100, restLength: cfg.rest },
        dragRef.current,
        dragPointRef.current,
      );
      velRef.current = out.vel;
      commitPos(out.pos);
      if (!dragRef.current && out.energy < 0.004) stableFrames++;
      else stableFrames = 0;
      if (stableFrames > 55) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, kind, interactive]);

  const order = useMemo(
    () => (interactive ? traverseOrder(model.nodes, model.edges, travMode, directed) : []),
    [interactive, model, travMode, directed],
  );

  // 访问动画播放
  useEffect(() => {
    if (!travPlaying) return;
    const t = setInterval(() => {
      setTravAt((a) => {
        if (a + 1 >= order.length) {
          setTravPlaying(false);
          return a;
        }
        return a + 1;
      });
    }, 650);
    return () => clearInterval(t);
  }, [travPlaying, order.length]);

  const crossings = useMemo(
    () => (interactive && kind !== "tree" ? countCrossings(pos, model.edges) : kind === "tree" ? countCrossings(pos, model.edges) : 0),
    [interactive, kind, pos, model.edges],
  );

  const highlight = useMemo(() => {
    const m = new Map<string, "done" | "cur">();
    if (travAt >= 0) {
      order.slice(0, travAt).forEach((n) => m.set(n, "done"));
      if (order[travAt]) m.set(order[travAt], "cur");
    }
    return m;
  }, [order, travAt]);

  const physicsOptions = {
    repulsion: physics.repulsion / 100,
    spring: physics.spring / 100,
    restLength: physics.rest,
  };

  const optimize = () => {
    if (kind === "tree" && model.children) {
      commitPos(treeLayout(model.children, model.treeRoot).pos);
      setNote("已按重心排序重新布局（同层边交叉最少）");
    } else {
      const out = simulatePhysics(posRef.current, model.edges, GW, GH, 360, physicsOptions);
      velRef.current = createVelocities(model.nodes);
      commitPos(out.pos);
      setNote(`已运行物理优化：边交叉降到 ${countCrossings(out.pos, model.edges)}，节点间距已拉开`);
    }
    setPlaying(false);
  };

  const resetCircle = () => {
    commitPos(circleLayout(model.nodes, GW, GH));
    velRef.current = createVelocities(model.nodes);
    setPlaying(kind !== "tree");
    setNote("已恢复圆形初始布局");
  };

  const spreadOut = () => {
    const center = { x: GW / 2, y: GH / 2 };
    velRef.current = new Map(
      model.nodes.map((id, i) => {
        const p = posRef.current.get(id) ?? center;
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const d = Math.max(24, Math.hypot(dx, dy));
        const kick = 3.4 + (i % 5) * 0.35;
        return [id, { x: (dx / d) * kick, y: (dy / d) * kick }] as [string, Pt];
      }),
    );
    setPlaying(true);
    setNote("已给节点一个向外的冲量，接下来会由斥力与弹簧自动排布");
  };

  // ---------- 静态图（线段树 / 流程 / DP / Mermaid） ----------
  const staticOut = useMemo(() => (interactive ? { svg: "", error: "" } : buildDiagram(kind, input, directed)), [interactive, kind, input, directed]);

  const currentSvg = interactive
    ? model.nodes.length
      ? renderGraphSvg(model.nodes, model.edges, pos, {
          directed,
          w: treeSize.w,
          h: treeSize.h,
          highlight: travAt >= 0 ? highlight : undefined,
        })
      : ""
    : staticOut.svg;
  const error = interactive ? (model.nodes.length ? "" : "先在左侧输入结构。") : staticOut.error;

  // ---------- 拖拽 ----------
  const toSvgPoint = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / Math.max(1, r.width)) * treeSize.w,
      y: ((e.clientY - r.top) / Math.max(1, r.height)) * treeSize.h,
    };
  };
  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = id;
    const p = posRef.current.get(id);
    dragPointRef.current = p ? { ...p } : null;
    dragVelRef.current = { x: 0, y: 0 };
    lastDragAtRef.current = performance.now();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (kind !== "tree") setPlaying(true);
  };
  const onSvgMove = (e: React.PointerEvent) => {
    const id = dragRef.current;
    if (!id) return;
    const p = toSvgPoint(e);
    const clamped = { x: Math.min(treeSize.w - 20, Math.max(20, p.x)), y: Math.min(treeSize.h - 20, Math.max(20, p.y)) };
    const prevPoint = dragPointRef.current;
    if (prevPoint) {
      dragVelRef.current = { x: (clamped.x - prevPoint.x) * 0.55, y: (clamped.y - prevPoint.y) * 0.55 };
    }
    dragPointRef.current = clamped;
    lastDragAtRef.current = performance.now();
    const next = new Map(posRef.current);
    next.set(id, clamped);
    commitPos(next);
  };
  const endDrag = () => {
    const id = dragRef.current;
    if (id && kind !== "tree" && performance.now() - lastDragAtRef.current < 90) {
      const v = dragVelRef.current;
      const sp = Math.hypot(v.x, v.y);
      const capped = sp > 11 ? { x: (v.x / sp) * 11, y: (v.y / sp) * 11 } : v;
      velRef.current = new Map(velRef.current).set(id, capped);
      setPlaying(true);
    }
    dragRef.current = null;
    dragPointRef.current = null;
  };

  const pick = (k: DiagramKind) => {
    setKind(k);
    setInput(DIAGRAM_EXAMPLES[k]);
    setNote("");
    setPlaying(k !== "tree");
  };

  const download = () => {
    if (!currentSvg) return;
    const blob = new Blob([currentSvg], { type: "image/svg+xml;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "diagram.svg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setNote("已下载 diagram.svg");
  };
  const copy = async () => {
    if (!currentSvg) return;
    try {
      await navigator.clipboard.writeText(currentSvg);
      setNote("SVG 源码已复制");
    } catch {
      setNote("剪贴板不可用，请用「导出 SVG」");
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dlg-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">算法图示编辑器</div>
            <div className="modal-sub">图 / DOT 使用真实物理布局：节点互相排斥、边像弹簧、拖动会回弹；树保持层级布局，所有节点都可拖。</div>
          </div>
          <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="diagram-body">
          <div className="diagram-side">
            <div className="seg diagram-seg" role="group" aria-label="图示类型">
              {KINDS.map((k) => (
                <button key={k} className={kind === k ? "on" : ""} onClick={() => pick(k)}>
                  {DIAGRAM_LABEL[k]}
                </button>
              ))}
            </div>
            {kind === "graph" && (
              <label className="diagram-check">
                <input type="checkbox" checked={directed} onChange={(e) => setDirected(e.target.checked)} />
                有向图（带箭头）
              </label>
            )}
            <textarea
              className="diagram-input thin"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              aria-label="图示结构输入"
              rows={8}
            />
            <div className="diagram-hint">{HINTS[kind]}</div>
            {interactive && model.nodes.length > 0 && (
              <div className="diagram-tools">
                <div className="diagram-toolrow">
                  {kind !== "tree" && (
                    <button className="mini-btn" onClick={() => setPlaying((p) => !p)}>
                      {playing ? <Pause size={11} /> : <Play size={11} />}
                      {playing ? "暂停物理" : "播放物理"}
                    </button>
                  )}
                  <button className="mini-btn" onClick={optimize}>
                    <Sparkles size={11} />
                    稳定布局
                  </button>
                  {kind !== "tree" && (
                    <button className="mini-btn" onClick={spreadOut}>
                      散开节点
                    </button>
                  )}
                  {kind !== "tree" && (
                    <button className="mini-btn" onClick={resetCircle}>
                      <RotateCcw size={11} />
                      圆形布局
                    </button>
                  )}
                </div>
                <div className="diagram-status">
                  <span>{kind === "tree" ? "层级布局" : playing ? "物理模拟中" : "物理已停稳"}</span>
                  <span>{model.nodes.length} 点 · {model.edges.length} 边</span>
                  <span>边交叉 {crossings}</span>
                </div>
                {kind !== "tree" && (
                  <div className="physics-controls" aria-label="物理参数">
                    <label>
                      <span>斥力 {physics.repulsion}%</span>
                      <input
                        type="range"
                        min={40}
                        max={220}
                        step={5}
                        value={physics.repulsion}
                        onChange={(e) => { setPhysics((v) => ({ ...v, repulsion: Number(e.target.value) })); setPlaying(true); }}
                      />
                    </label>
                    <label>
                      <span>边弹力 {physics.spring}%</span>
                      <input
                        type="range"
                        min={30}
                        max={220}
                        step={5}
                        value={physics.spring}
                        onChange={(e) => { setPhysics((v) => ({ ...v, spring: Number(e.target.value) })); setPlaying(true); }}
                      />
                    </label>
                    <label>
                      <span>理想边长 {physics.rest}px</span>
                      <input
                        type="range"
                        min={70}
                        max={190}
                        step={2}
                        value={physics.rest}
                        onChange={(e) => { setPhysics((v) => ({ ...v, rest: Number(e.target.value) })); setPlaying(true); }}
                      />
                    </label>
                  </div>
                )}
                <div className="diagram-toolrow">
                  <div className="seg" role="group" aria-label="遍历方式">
                    <button className={travMode === "bfs" ? "on" : ""} onClick={() => { setTravMode("bfs"); setTravAt(-1); }}>
                      BFS
                    </button>
                    <button className={travMode === "dfs" ? "on" : ""} onClick={() => { setTravMode("dfs"); setTravAt(-1); }}>
                      DFS
                    </button>
                  </div>
                  <button className="mini-btn" onClick={() => setTravAt((a) => Math.max(-1, a - 1))} title="上一步">
                    <StepBack size={11} />
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => {
                      if (travAt >= order.length - 1) setTravAt(0);
                      setTravPlaying((p) => !p);
                    }}
                  >
                    {travPlaying ? <Pause size={11} /> : <Play size={11} />}
                    访问动画
                  </button>
                  <button className="mini-btn" onClick={() => setTravAt((a) => Math.min(order.length - 1, a + 1))} title="下一步">
                    <StepForward size={11} />
                  </button>
                  <button className="mini-btn" onClick={() => { setTravAt(-1); setTravPlaying(false); }} title="重置访问">
                    <RotateCcw size={11} />
                  </button>
                </div>
                {travAt >= 0 && (
                  <div className="diagram-hint">
                    访问顺序（{travMode.toUpperCase()}）：{order.slice(0, travAt + 1).join(" → ") || "—"}
                    {travAt + 1 < order.length ? ` · 还剩 ${order.length - travAt - 1} 个` : " · 已完成"}
                  </div>
                )}
              </div>
            )}
            {error && <div className="diagram-err">{error}</div>}
            {note && <div className="diagram-note">{note}</div>}
          </div>

          <div className="diagram-preview thin" aria-label="图示预览">
            {interactive ? (
              model.nodes.length ? (
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${treeSize.w} ${treeSize.h}`}
                  className="diagram-canvas"
                  onPointerMove={onSvgMove}
                  onPointerUp={endDrag}
                  onPointerLeave={endDrag}
                >
                  <defs>
                    <marker id="arrI" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" fill="#8a8f98" />
                    </marker>
                  </defs>
                  {model.edges.map((e, i) => {
                    const a = pos.get(e.u);
                    const b = pos.get(e.v);
                    if (!a || !b) return null;
                    if (e.u === e.v) return <circle key={i} cx={a.x} cy={a.y - 25} r="13" fill="none" stroke="#c6c9d4" strokeWidth="1.6" />;
                    let ex = b.x;
                    let ey = b.y;
                    if (directed) {
                      const dx = b.x - a.x;
                      const dy = b.y - a.y;
                      const len = Math.hypot(dx, dy) || 1;
                      ex = b.x - (dx / len) * 20;
                      ey = b.y - (dy / len) * 20;
                    }
                    return (
                      <g key={i}>
                        <line x1={a.x} y1={a.y} x2={ex} y2={ey} stroke="#c6c9d4" strokeWidth="1.6" markerEnd={directed ? "url(#arrI)" : undefined} />
                        {e.w && (
                          <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} textAnchor="middle" fontSize="11.5" fill="#8a8f98">
                            {e.w}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {model.nodes.map((n) => {
                    const p = pos.get(n);
                    if (!p) return null;
                    const st = highlight.get(n);
                    return (
                      <g
                        key={n}
                        className="diagram-node"
                        onPointerDown={onNodeDown(n)}
                        style={{ cursor: "grab" }}
                      >
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r="17"
                          fill={st === "cur" ? "#d97706" : st === "done" ? "#5b5bd6" : "#eef0ff"}
                          stroke={st === "cur" ? "#b45309" : "#5b5bd6"}
                          strokeWidth="1.7"
                        />
                        <text x={p.x} y={p.y + 4.5} textAnchor="middle" fill={st ? "#ffffff" : "#26232b"} style={{ pointerEvents: "none" }}>
                          {n}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <div className="diagram-empty">在左侧输入结构，这里会出现可拖拽的画布。</div>
              )
            ) : staticOut.svg ? (
              <div dangerouslySetInnerHTML={{ __html: staticOut.svg }} />
            ) : (
              <div className="diagram-empty">在左侧输入结构，这里会实时画出图示。</div>
            )}
          </div>
        </div>

        <div className="modal-foot-actions">
          <button className="bar-btn" onClick={copy} disabled={!currentSvg}>
            <ClipboardCopy size={13} />
            复制 SVG
          </button>
          <button className="bar-btn" onClick={download} disabled={!currentSvg}>
            <Download size={13} />
            导出 SVG
          </button>
          <button
            className="bar-btn accented"
            disabled={!currentSvg}
            onClick={() => {
              onInsert(currentSvg);
              onClose();
            }}
          >
            <FileInput size={13} />
            插入题解
          </button>
        </div>
      </div>
    </div>
  );
}
