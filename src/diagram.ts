/**
 * 算法图示生成器：把简单的文本描述变成 SVG。
 * 全部是纯函数，不依赖 DOM，方便测试，也保证「导出 SVG」与预览里看到的一致。
 *
 * 输入格式（每种都很宽松，空格或逗号分隔）：
 *  - tree    每行一条边「父 子」；或第一行是层序数组（# 表示空），如 `1 2 3 # 4`
 *  - graph   每行一条边「u v [权重]」
 *  - segtree 一串数字（最多 16 个），如 `1 3 5 7 9 11`
 *  - flow    每行一个步骤；以 ? 或 ？ 结尾的画成判断菱形
 *  - dp      每行一个 DP 行，空格分隔：`0 1 2` / `0 2 3` …
 */

export type DiagramKind = "tree" | "graph" | "segtree" | "flow" | "dp" | "mermaid" | "dot";

export const DIAGRAM_LABEL: Record<DiagramKind, string> = {
  tree: "树",
  graph: "图",
  segtree: "线段树",
  flow: "流程图",
  dp: "DP 转移",
  mermaid: "Mermaid",
  dot: "Graphviz",
};

export const DIAGRAM_EXAMPLES: Record<DiagramKind, string> = {
  tree: "1 2\n1 3\n2 4\n2 5\n3 6",
  graph: "A B 4\nA C 2\nB C 1\nB D 5\nC D 8",
  segtree: "5 2 8 1 9 3",
  flow: "读入 n 与数组 a\n排序\n是否已满足条件？\n输出答案",
  dp: "0 0 0 0\n0 2 3 4\n0 2 5 6\n0 3 5 9",
  mermaid: "graph TD\n  A[读入数据] --> B{是否排序}\n  B -->|是| C[二分查找]\n  B -->|否| D[先排序]\n  D --> C",
  dot: "digraph G {\n  A -> B [label=\"4\"];\n  A -> C [label=\"2\"];\n  B -> D;\n  C -> D;\n}",
};

export interface DiagramOut {
  svg: string;
  error: string;
}

const INK = "#26232b";
const MUT = "#8a8f98";
const LINE = "#c6c9d4";
const ACCENT = "#5b5bd6";
const FILL = "#eef0ff";
const PAPER = "#ffffff";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const tokens = (line: string) => line.split(/[\s,，、]+/).filter(Boolean);

function wrap(w: number, h: number, inner: string, directed = false): string {
  const defs = directed
    ? `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${MUT}"/></marker></defs>`
    : `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${MUT}"/></marker></defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="'Fira Code',ui-monospace,Menlo,Consolas,monospace" font-size="13">${defs}${inner}</svg>`;
}

function circle(x: number, y: number, label: string, r = 16): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${FILL}" stroke="${ACCENT}" stroke-width="1.6"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" fill="${INK}">${esc(label)}</text>`;
}

function line(x1: number, y1: number, x2: number, y2: number, arrow = false): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${LINE}" stroke-width="1.6"${arrow ? ' marker-end="url(#arr)"' : ""}/>`;
}

// ---------------------------------------------------------------- 树
function buildTree(input: string): DiagramOut {
  const rawLines = input.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!rawLines.length) return { svg: "", error: "先输入树的结构：每行一条边，如「1 2」。" };
  const children = new Map<string, string[]>();
  const nodes: string[] = [];
  const seen = new Set<string>();
  const addNode = (n: string) => {
    if (!seen.has(n)) {
      seen.add(n);
      nodes.push(n);
    }
  };
  const addEdge = (p: string, c: string) => {
    addNode(p);
    addNode(c);
    const arr = children.get(p) ?? [];
    if (!arr.includes(c)) arr.push(c);
    children.set(p, arr);
  };

  if (rawLines.length === 1 && tokens(rawLines[0]).length >= 2) {
    // 层序数组：1 2 3 # 4
    const arr = tokens(rawLines[0]);
    if (arr[0] === "#" || arr[0] === "null") return { svg: "", error: "层序数组的第一个元素不能是空。" };
    const queue: string[] = [arr[0]];
    addNode(arr[0]);
    let i = 1;
    while (queue.length && i < arr.length) {
      const p = queue.shift()!;
      for (let k = 0; k < 2; k++) {
        if (i >= arr.length) break;
        const v = arr[i++];
        if (v !== "#" && v !== "null" && v !== "NULL") {
          addEdge(p, v);
          queue.push(v);
        }
      }
    }
    return layoutTree(nodes[0], children);
  }
  for (const l of rawLines) {
    const t = tokens(l);
    if (t.length >= 2) addEdge(t[0], t[1]);
    else if (t.length === 1) addNode(t[0]);
  }
  if (!nodes.length) return { svg: "", error: "没有识别到节点。" };
  const childSet = new Set<string>();
  children.forEach((cs) => cs.forEach((c) => childSet.add(c)));
  const root = nodes.find((n) => !childSet.has(n)) ?? nodes[0];
  return layoutTree(root, children);
}

function layoutTree(root: string, children: Map<string, string[]>): DiagramOut {
  const X = 56;
  const Y = 78;
  const pos = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  const place = (n: string, depth: number): number => {
    const cs = children.get(n) ?? [];
    let x: number;
    if (!cs.length) {
      x = cursor++ * X;
    } else {
      const xs = cs.map((c) => place(c, depth + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    pos.set(n, { x, y: depth * Y });
    return x;
  };
  place(root, 0);
  let maxX = 0;
  let maxY = 0;
  pos.forEach((p) => {
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  const M = 34;
  let edges = "";
  children.forEach((cs, p) => {
    const a = pos.get(p);
    if (!a) return;
    for (const c of cs) {
      const b = pos.get(c);
      if (b) edges += line(a.x + M, a.y + M, b.x + M, b.y + M);
    }
  });
  let circles = "";
  pos.forEach((p, n) => {
    circles += circle(p.x + M, p.y + M, n);
  });
  return { svg: wrap(maxX + M * 2, maxY + M * 2, edges + circles), error: "" };
}

// ---------------------------------------------------------------- 图
function buildGraph(input: string, directed: boolean): DiagramOut {
  const rawLines = input.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!rawLines.length) return { svg: "", error: "先输入图的边：每行「u v [权重]」。" };
  const nodes: string[] = [];
  const seen = new Set<string>();
  const edges: { u: string; v: string; w: string }[] = [];
  for (const l of rawLines) {
    const t = tokens(l);
    if (t.length < 2) continue;
    for (const n of [t[0], t[1]]) {
      if (!seen.has(n)) {
        seen.add(n);
        nodes.push(n);
      }
    }
    edges.push({ u: t[0], v: t[1], w: t[2] ?? "" });
  }
  if (!nodes.length) return { svg: "", error: "没有识别到节点。" };
  const R = Math.max(95, nodes.length * 24);
  const cx = R + 42;
  const cy = R + 42;
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(n, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });
  let body = "";
  for (const e of edges) {
    const a = pos.get(e.u)!;
    const b = pos.get(e.v)!;
    if (e.u === e.v) {
      body += `<circle cx="${a.x}" cy="${a.y - 24}" r="13" fill="none" stroke="${LINE}" stroke-width="1.6"/>`;
      continue;
    }
    // 箭头别压在节点圆里：把终点往回缩一个半径
    let ex = b.x;
    let ey = b.y;
    if (directed) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      ex = b.x - (dx / len) * 19;
      ey = b.y - (dy / len) * 19;
    }
    body += line(a.x, a.y, ex, ey, directed);
    if (e.w) {
      body += `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 5}" text-anchor="middle" font-size="11.5" fill="${MUT}">${esc(e.w)}</text>`;
    }
  }
  nodes.forEach((n) => {
    const p = pos.get(n)!;
    body += circle(p.x, p.y, n);
  });
  return { svg: wrap(cx * 2, cy * 2, body, true), error: "" };
}

// ---------------------------------------------------------------- 线段树
function buildSegtree(input: string): DiagramOut {
  const nums = input
    .split(/[\s,，、]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return { svg: "", error: "先输入一组数字，如「5 2 8 1」。" };
  if (nums.length > 16) return { svg: "", error: "线段树最多画 16 个数，太多了图会挤成一团。" };
  interface SN {
    l: number;
    r: number;
    sum: number;
    depth: number;
    x: number;
    /** 节点编号：堆式编号，根为 1，左孩子 2p，右孩子 2p+1，与代码里 tr[p] 的下标一致 */
    idx: number;
    kids: SN[];
  }
  const build = (l: number, r: number, depth: number, idx: number): SN => {
    if (l === r) return { l, r, sum: nums[l], depth, x: 0, idx, kids: [] };
    const mid = (l + r) >> 1;
    const left = build(l, mid, depth + 1, idx * 2);
    const right = build(mid + 1, r, depth + 1, idx * 2 + 1);
    return { l, r, sum: left.sum + right.sum, depth, x: 0, idx, kids: [left, right] };
  };
  const root = build(0, nums.length - 1, 0, 1);
  const LEAF = 78;
  const Y = 66;
  const place = (n: SN): number => {
    if (!n.kids.length) {
      n.x = n.l * LEAF + LEAF / 2;
    } else {
      const xs = n.kids.map(place);
      n.x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    return n.x;
  };
  place(root);
  let edges = "";
  let boxes = "";
  const draw = (n: SN) => {
    const y = n.depth * Y + 30;
    for (const k of n.kids) {
      edges += line(n.x, y + 17, k.x, k.depth * Y + 13);
      draw(k);
    }
    boxes +=
      `<rect x="${n.x - 34}" y="${y - 17}" width="68" height="34" rx="8" fill="${PAPER}" stroke="${ACCENT}" stroke-width="1.4"><title>节点 ${n.idx}：区间 [${n.l}, ${n.r}]，和 ${n.sum}</title></rect>` +
      `<text x="${n.x}" y="${y - 2}" text-anchor="middle" font-size="10.5" fill="${MUT}">[${n.l}, ${n.r}]</text>` +
      `<text x="${n.x}" y="${y + 12}" text-anchor="middle" font-size="13" fill="${INK}">${n.sum}</text>` +
      `<circle cx="${n.x - 34}" cy="${y - 17}" r="9" fill="${ACCENT}" stroke="${PAPER}" stroke-width="1.5"/>` +
      `<text x="${n.x - 34}" y="${y - 13.5}" text-anchor="middle" font-size="9" font-weight="600" fill="${PAPER}">${n.idx}</text>`;
  };
  draw(root);
  let maxDepth = 0;
  const walk = (n: SN) => {
    maxDepth = Math.max(maxDepth, n.depth);
    n.kids.forEach(walk);
  };
  walk(root);
  return { svg: wrap(nums.length * LEAF + 8, (maxDepth + 1) * Y + 16, edges + boxes), error: "" };
}

// ---------------------------------------------------------------- 流程图
function buildFlow(input: string): DiagramOut {
  const steps = input.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!steps.length) return { svg: "", error: "先输入流程：每行一个步骤。" };
  const maxLen = Math.max(...steps.map((s) => [...s].length));
  const W = Math.min(460, Math.max(250, maxLen * 14 + 48));
  const H = 40;
  const GAP = 30;
  const cx = W / 2 + 16;
  let body = "";
  steps.forEach((s, i) => {
    const y = 16 + i * (H + GAP);
    if (i > 0) body += `<line x1="${cx}" y1="${y - GAP}" x2="${cx}" y2="${y}" stroke="${MUT}" stroke-width="1.6" marker-end="url(#arr)"/>`;
    const isCond = /[?？]$/.test(s);
    if (isCond) {
      const hw = W / 2;
      const hh = H * 0.72;
      body += `<polygon points="${cx},${y} ${cx + hw},${y + hh} ${cx},${y + 2 * hh} ${cx - hw},${y + hh}" fill="${FILL}" stroke="${ACCENT}" stroke-width="1.5"/>`;
      body += `<text x="${cx}" y="${y + hh + 4.5}" text-anchor="middle" fill="${INK}">${esc(s)}</text>`;
    } else {
      body += `<rect x="${cx - W / 2}" y="${y}" width="${W}" height="${H}" rx="9" fill="${PAPER}" stroke="${ACCENT}" stroke-width="1.5"/>`;
      body += `<text x="${cx}" y="${y + H / 2 + 4.5}" text-anchor="middle" fill="${INK}">${esc(s)}</text>`;
    }
  });
  const lastCond = /[?？]$/.test(steps[steps.length - 1]);
  const height = 16 + steps.length * (H + GAP) - GAP + (lastCond ? H * 0.5 : 0) + 14;
  return { svg: wrap(W + 32, height, body, true), error: "" };
}

// ---------------------------------------------------------------- DP 转移
function buildDp(input: string): DiagramOut {
  const rows = input
    .split("\n")
    .map((l) => tokens(l))
    .filter((r) => r.length);
  if (!rows.length) return { svg: "", error: "先输入 DP 表格：每行一个状态行，如「0 2 3」。" };
  const cols = Math.max(...rows.map((r) => r.length));
  const CW = 52;
  const CH = 40;
  const OX = 30;
  const OY = 30;
  const val = (i: number, j: number) => {
    const n = Number(rows[i]?.[j]);
    return Number.isFinite(n) ? n : NaN;
  };
  let max = 0;
  rows.forEach((r, i) =>
    r.forEach((_, j) => {
      const v = val(i, j);
      if (Number.isFinite(v)) max = Math.max(max, v);
    }),
  );
  let arrows = "";
  let cells = "";
  // 列 / 行标号
  for (let j = 0; j < cols; j++) arrows += `<text x="${OX + j * CW + CW / 2}" y="${OY - 9}" text-anchor="middle" font-size="11" fill="${MUT}">${j}</text>`;
  rows.forEach((_, i) => {
    arrows += `<text x="${OX - 9}" y="${OY + i * CH + CH / 2 + 4}" text-anchor="middle" font-size="11" fill="${MUT}">${i}</text>`;
  });
  // 转移箭头：从左 / 上两个前驱里较大的那个指向当前格
  rows.forEach((r, i) =>
    r.forEach((_, j) => {
      if (i === 0 && j === 0) return;
      const fromTop = i > 0 ? val(i - 1, j) : NaN;
      const fromLeft = j > 0 ? val(i, j - 1) : NaN;
      if (!Number.isFinite(fromTop) && !Number.isFinite(fromLeft)) return;
      const useTop = Number.isFinite(fromTop) && (!Number.isFinite(fromLeft) || fromTop >= fromLeft);
      // 只在两个格子的边缘之间连线，箭头不压数字
      const cx2 = OX + j * CW + CW / 2;
      const cy2 = OY + i * CH + CH / 2;
      const x1 = useTop ? cx2 : OX + (j - 1) * CW + CW / 2 + CW / 2 - 3;
      const y1 = useTop ? OY + (i - 1) * CH + CH / 2 + CH / 2 - 3 : cy2;
      const x2 = useTop ? cx2 : cx2 - CW / 2 + 3;
      const y2 = useTop ? cy2 - CH / 2 + 3 : cy2;
      arrows += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${MUT}" stroke-width="1.3" stroke-dasharray="3 3" marker-end="url(#arr)"/>`;
    }),
  );
  rows.forEach((r, i) =>
    r.forEach((cell, j) => {
      const x = OX + j * CW;
      const y = OY + i * CH;
      const v = val(i, j);
      const alpha = Number.isFinite(v) && max > 0 ? 0.07 + 0.28 * Math.max(0, v / max) : 0.04;
      cells += `<rect x="${x + 2}" y="${y + 2}" width="${CW - 4}" height="${CH - 4}" rx="7" fill="rgba(91,91,214,${alpha.toFixed(3)})" stroke="${LINE}"/>`;
      cells += `<text x="${x + CW / 2}" y="${y + CH / 2 + 4.5}" text-anchor="middle" fill="${INK}">${esc(cell)}</text>`;
    }),
  );
  return { svg: wrap(OX + cols * CW + 14, OY + rows.length * CH + 14, arrows + cells, true), error: "" };
}

export function buildDiagram(kind: DiagramKind, input: string, directed = false): DiagramOut {
  switch (kind) {
    case "tree":
      return buildTree(input);
    case "graph":
      return buildGraph(input, directed);
    case "segtree":
      return buildSegtree(input);
    case "flow":
      return buildFlow(input);
    case "dp":
      return buildDp(input);
    case "mermaid":
      return buildMermaid(input);
    case "dot":
      return buildDot(input);
  }
}

// ============================================================ 交互画布模型
// 图 / 树 / DOT 在弹窗里用这套模型：节点可拖、力导向动画、自动优化布局。

export interface Pt {
  x: number;
  y: number;
}
export interface GEdge2 {
  u: string;
  v: string;
  w: string;
}
export type PosMap = Map<string, Pt>;

const uniqPush = (arr: string[], v: string) => {
  if (!arr.includes(v)) arr.push(v);
};

/** 解析图输入（每行 u v [w]） */
export function parseGraphInput(input: string): { nodes: string[]; edges: GEdge2[] } {
  const nodes: string[] = [];
  const edges: GEdge2[] = [];
  for (const l of input.split("\n").map((x) => x.trim()).filter(Boolean)) {
    const t = tokens(l);
    if (t.length < 2) continue;
    uniqPush(nodes, t[0]);
    uniqPush(nodes, t[1]);
    edges.push({ u: t[0], v: t[1], w: t[2] ?? "" });
  }
  return { nodes, edges };
}

/** 解析树输入（边列表或层序数组），返回根与孩子表 */
export function parseTreeInput(input: string): { root: string; children: Map<string, string[]>; nodes: string[]; edges: GEdge2[] } {
  const rawLines = input.split("\n").map((l) => l.trim()).filter(Boolean);
  const children = new Map<string, string[]>();
  const nodes: string[] = [];
  const edges: GEdge2[] = [];
  const addEdge = (p: string, c: string) => {
    uniqPush(nodes, p);
    uniqPush(nodes, c);
    const arr = children.get(p) ?? [];
    if (!arr.includes(c)) arr.push(c);
    children.set(p, arr);
    edges.push({ u: p, v: c, w: "" });
  };
  if (rawLines.length === 1 && tokens(rawLines[0]).length >= 2) {
    const arr = tokens(rawLines[0]);
    if (arr[0] !== "#" && arr[0] !== "null") {
      uniqPush(nodes, arr[0]);
      const queue: string[] = [arr[0]];
      let i = 1;
      while (queue.length && i < arr.length) {
        const p = queue.shift()!;
        for (let k = 0; k < 2 && i < arr.length; k++) {
          const v = arr[i++];
          if (v !== "#" && v !== "null" && v !== "NULL") {
            addEdge(p, v);
            queue.push(v);
          }
        }
      }
    }
  } else {
    for (const l of rawLines) {
      const t = tokens(l);
      if (t.length >= 2) addEdge(t[0], t[1]);
      else if (t.length === 1) uniqPush(nodes, t[0]);
    }
  }
  const childSet = new Set<string>();
  children.forEach((cs) => cs.forEach((c) => childSet.add(c)));
  const root = nodes.find((n) => !childSet.has(n)) ?? nodes[0] ?? "";
  return { root, children, nodes, edges };
}

/** 树布局：分层 + 重心排序（barycenter）迭代，减少同层边交叉 */
export function treeLayout(children: Map<string, string[]>, root: string): { pos: PosMap; w: number; h: number } {
  const X = 62;
  const Y = 82;
  const compute = (): PosMap => {
    const pos: PosMap = new Map();
    let cursor = 0;
    const place = (n: string, depth: number): number => {
      const cs = children.get(n) ?? [];
      let x: number;
      if (!cs.length) x = cursor++ * X;
      else {
        const xs = cs.map((c) => place(c, depth + 1));
        x = (xs[0] + xs[xs.length - 1]) / 2;
      }
      pos.set(n, { x: x + 36, y: depth * Y + 36 });
      return x;
    };
    if (root) place(root, 0);
    return pos;
  };
  let pos = compute();
  // 按孩子当前 x 重排兄弟顺序，重复几轮收敛
  for (let iter = 0; iter < 4; iter++) {
    children.forEach((cs) => {
      cs.sort((a, b) => (pos.get(a)?.x ?? 0) - (pos.get(b)?.x ?? 0));
    });
    pos = compute();
  }
  let w = 0;
  let h = 0;
  pos.forEach((p) => {
    w = Math.max(w, p.x);
    h = Math.max(h, p.y);
  });
  return { pos, w: w + 36, h: h + 36 };
}

/** 圆周初始布局 */
export function circleLayout(nodes: string[], w = 660, h = 480): PosMap {
  const pos: PosMap = new Map();
  const R = Math.max(80, Math.min(w, h) / 2 - 56);
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    pos.set(n, { x: w / 2 + R * Math.cos(a), y: h / 2 + R * Math.sin(a) });
  });
  return pos;
}

/** Fruchterman-Reingold 单步（纯函数，返回新位置） */
export function forceStep(pos: PosMap, edges: GEdge2[], w: number, h: number, temp: number, pinned?: string | null): PosMap {
  const nodes = [...pos.keys()];
  const n = Math.max(1, nodes.length);
  const k = Math.sqrt((w * h) / n) * 0.9;
  const disp = new Map<string, Pt>(nodes.map((id) => [id, { x: 0, y: 0 }]));
  // 斥力
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = pos.get(nodes[i])!;
      const b = pos.get(nodes[j])!;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d = Math.hypot(dx, dy);
      if (d < 0.01) {
        dx = (i - j) * 0.1 + 0.05;
        dy = 0.07;
        d = Math.hypot(dx, dy);
      }
      const f = (k * k) / d;
      const da = disp.get(nodes[i])!;
      const db = disp.get(nodes[j])!;
      da.x += (dx / d) * f;
      da.y += (dy / d) * f;
      db.x -= (dx / d) * f;
      db.y -= (dy / d) * f;
    }
  }
  // 引力（沿边）
  for (const e of edges) {
    const a = pos.get(e.u);
    const b = pos.get(e.v);
    if (!a || !b || e.u === e.v) continue;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const f = (d * d) / k;
    const da = disp.get(e.u)!;
    const db = disp.get(e.v)!;
    da.x -= (dx / d) * f;
    da.y -= (dy / d) * f;
    db.x += (dx / d) * f;
    db.y += (dy / d) * f;
  }
  const next: PosMap = new Map();
  for (const id of nodes) {
    const p = pos.get(id)!;
    if (id === pinned) {
      next.set(id, { ...p });
      continue;
    }
    const d = disp.get(id)!;
    const len = Math.hypot(d.x, d.y) || 0.01;
    const step = Math.min(len, temp);
    // 轻微向心，避免飘出画布
    const gx = (w / 2 - p.x) * 0.002 * step;
    const gy = (h / 2 - p.y) * 0.002 * step;
    next.set(id, {
      x: Math.min(w - 24, Math.max(24, p.x + (d.x / len) * step + gx)),
      y: Math.min(h - 24, Math.max(24, p.y + (d.y / len) * step + gy)),
    });
  }
  return next;
}

export type VelMap = Map<string, Pt>;

export interface PhysicsOptions {
  /** 节点斥力倍率，1 为默认 */
  repulsion?: number;
  /** 边弹簧倍率，1 为默认 */
  spring?: number;
  /** 边的理想长度（像素），不传时按画布与节点数估算 */
  restLength?: number;
  /** 阻尼 0~1，越大越快停稳 */
  damping?: number;
}

/** 给一组节点创建零速度表 */
export function createVelocities(nodes: string[]): VelMap {
  return new Map(nodes.map((n) => [n, { x: 0, y: 0 }]));
}

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 物理布局单步：节点带速度，节点间有斥力与最小间距，边是弹簧。
 * 这比旧的“温度步进”更接近 CSAcademy Graph Editor：拖动一个点，
 * 相连节点会被边拉动，不相连的节点会被推开，松手后还会回弹并逐渐停稳。
 */
export function physicsStep(
  pos: PosMap,
  vel: VelMap,
  edges: GEdge2[],
  w: number,
  h: number,
  options: PhysicsOptions = {},
  pinned?: string | null,
  pinnedPos?: Pt | null,
): { pos: PosMap; vel: VelMap; energy: number } {
  const nodes = [...pos.keys()];
  const n = Math.max(1, nodes.length);
  const rest = options.restLength ?? clampNum(Math.sqrt((w * h) / n) * 0.52, 84, 150);
  const repulsion = 4300 * (options.repulsion ?? 1);
  const springK = 0.045 * (options.spring ?? 1);
  const damping = clampNum(options.damping ?? 0.84, 0.5, 0.96);
  const force = new Map<string, Pt>(nodes.map((id) => [id, { x: 0, y: 0 }]));
  const add = (id: string, x: number, y: number) => {
    const f = force.get(id);
    if (f) {
      f.x += x;
      f.y += y;
    }
  };

  // 两两斥力 + 碰撞间距：重叠的点必须分开，不能只靠边决定位置
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = pos.get(nodes[i])!;
      const b = pos.get(nodes[j])!;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d = Math.hypot(dx, dy);
      if (d < 0.01) {
        const ang = (i * 37 + j * 17) * 0.71;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1;
      }
      const ux = dx / d;
      const uy = dy / d;
      let f = repulsion / Math.max(42, d * d);
      if (d < 46) f += (46 - d) * 0.13;
      f = Math.min(4.2, f);
      add(nodes[i], ux * f, uy * f);
      add(nodes[j], -ux * f, -uy * f);
    }
  }

  // 边弹簧：太长拉近，太短推开
  for (const e of edges) {
    const a = pos.get(e.u);
    const b = pos.get(e.v);
    if (!a || !b || e.u === e.v) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(6, Math.hypot(dx, dy));
    const f = springK * (d - rest);
    add(e.u, (dx / d) * f, (dy / d) * f);
    add(e.v, -(dx / d) * f, -(dy / d) * f);
  }

  // 弱向心 + 软边界，避免整图飘到角落或贴边
  for (const id of nodes) {
    const p = pos.get(id)!;
    add(id, (w / 2 - p.x) * 0.006, (h / 2 - p.y) * 0.006);
    if (p.x < 38) add(id, (38 - p.x) * 0.09, 0);
    if (p.x > w - 38) add(id, (w - 38 - p.x) * 0.09, 0);
    if (p.y < 38) add(id, 0, (38 - p.y) * 0.09);
    if (p.y > h - 38) add(id, 0, (h - 38 - p.y) * 0.09);
  }

  const nextPos: PosMap = new Map();
  const nextVel: VelMap = new Map();
  let energy = 0;
  for (const id of nodes) {
    const p = pos.get(id)!;
    if (id === pinned) {
      const q = pinnedPos ?? p;
      nextPos.set(id, { x: clampNum(q.x, 22, w - 22), y: clampNum(q.y, 22, h - 22) });
      nextVel.set(id, { x: 0, y: 0 });
      continue;
    }
    const f = force.get(id)!;
    const fl = Math.hypot(f.x, f.y);
    const scale = fl > 8 ? 8 / fl : 1;
    const oldV = vel.get(id) ?? { x: 0, y: 0 };
    let vx = (oldV.x + f.x * scale) * damping;
    let vy = (oldV.y + f.y * scale) * damping;
    const sp = Math.hypot(vx, vy);
    if (sp > 16) {
      vx = (vx / sp) * 16;
      vy = (vy / sp) * 16;
    }
    energy += vx * vx + vy * vy;
    nextVel.set(id, { x: vx, y: vy });
    nextPos.set(id, {
      x: clampNum(p.x + vx, 22, w - 22),
      y: clampNum(p.y + vy, 22, h - 22),
    });
  }
  return { pos: nextPos, vel: nextVel, energy: nodes.length ? energy / nodes.length : 0 };
}

/** 连续运行物理模拟，直到基本停稳或达到迭代上限 */
export function simulatePhysics(
  pos: PosMap,
  edges: GEdge2[],
  w: number,
  h: number,
  iterations = 280,
  options: PhysicsOptions = {},
): { pos: PosMap; vel: VelMap; energy: number } {
  let curPos = new Map([...pos].map(([k, v]) => [k, { ...v }]));
  let curVel = createVelocities([...pos.keys()]);
  let energy = Infinity;
  for (let i = 0; i < iterations; i++) {
    const out = physicsStep(curPos, curVel, edges, w, h, options);
    curPos = out.pos;
    curVel = out.vel;
    energy = out.energy;
    if (i > 35 && energy < 0.0008) break;
  }
  return { pos: curPos, vel: curVel, energy };
}

/** 跑满 iterations 步力导向（自动优化布局用） */
export function forceLayout(pos: PosMap, edges: GEdge2[], w: number, h: number, iterations = 260): PosMap {
  return simulatePhysics(pos, edges, w, h, iterations).pos;
}

/** 统计边交叉数（不计共享端点） */
export function countCrossings(pos: PosMap, edges: GEdge2[]): number {
  const seg = edges
    .filter((e) => e.u !== e.v && pos.has(e.u) && pos.has(e.v))
    .map((e) => ({ e, a: pos.get(e.u)!, b: pos.get(e.v)! }));
  const orient = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  let count = 0;
  for (let i = 0; i < seg.length; i++) {
    for (let j = i + 1; j < seg.length; j++) {
      const s1 = seg[i];
      const s2 = seg[j];
      if ([s1.e.u, s1.e.v].some((x) => x === s2.e.u || x === s2.e.v)) continue;
      const d1 = orient(s2.a, s2.b, s1.a);
      const d2 = orient(s2.a, s2.b, s1.b);
      const d3 = orient(s1.a, s1.b, s2.a);
      const d4 = orient(s1.a, s1.b, s2.b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) count++;
    }
  }
  return count;
}

/** 用任意位置渲染图 / 树 SVG（导出与插入用，保证和画布上看到的一致） */
export function renderGraphSvg(
  nodes: string[],
  edges: GEdge2[],
  pos: PosMap,
  opts: { directed?: boolean; w: number; h: number; highlight?: Map<string, "done" | "cur"> },
): string {
  let body = "";
  for (const e of edges) {
    const a = pos.get(e.u);
    const b = pos.get(e.v);
    if (!a || !b) continue;
    if (e.u === e.v) {
      body += `<circle cx="${a.x}" cy="${a.y - 25}" r="13" fill="none" stroke="${LINE}" stroke-width="1.6"/>`;
      continue;
    }
    let ex = b.x;
    let ey = b.y;
    if (opts.directed) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      ex = b.x - (dx / len) * 20;
      ey = b.y - (dy / len) * 20;
    }
    body += line(a.x, a.y, ex, ey, !!opts.directed);
    if (e.w) body += `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 5}" text-anchor="middle" font-size="11.5" fill="${MUT}">${esc(e.w)}</text>`;
  }
  for (const n of nodes) {
    const p = pos.get(n);
    if (!p) continue;
    const st = opts.highlight?.get(n);
    if (st === "cur") body += `<circle cx="${p.x}" cy="${p.y}" r="17" fill="#d97706" stroke="#b45309" stroke-width="1.8"/><text x="${p.x}" y="${p.y + 4.5}" text-anchor="middle" fill="#ffffff">${esc(n)}</text>`;
    else if (st === "done") body += `<circle cx="${p.x}" cy="${p.y}" r="17" fill="${ACCENT}" stroke="${ACCENT}" stroke-width="1.8"/><text x="${p.x}" y="${p.y + 4.5}" text-anchor="middle" fill="#ffffff">${esc(n)}</text>`;
    else body += circle(p.x, p.y, n, 17);
  }
  return wrap(opts.w, opts.h, body, true);
}

/** BFS / DFS 访问顺序（动画用） */
export function traverseOrder(nodes: string[], edges: GEdge2[], mode: "bfs" | "dfs", directed = false): string[] {
  if (!nodes.length) return [];
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const e of edges) {
    adj.get(e.u)?.push(e.v);
    if (!directed) adj.get(e.v)?.push(e.u);
  }
  const seen = new Set<string>();
  const order: string[] = [];
  const start = nodes[0];
  if (mode === "bfs") {
    const q = [start];
    seen.add(start);
    while (q.length) {
      const u = q.shift()!;
      order.push(u);
      for (const v of adj.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          q.push(v);
        }
      }
    }
  } else {
    const dfs = (u: string) => {
      seen.add(u);
      order.push(u);
      for (const v of adj.get(u) ?? []) if (!seen.has(v)) dfs(v);
    };
    dfs(start);
  }
  // 不连通的点按输入顺序补上
  for (const n of nodes) if (!seen.has(n)) order.push(n);
  return order;
}

// ---------------------------------------------------------------- Mermaid 子集
function buildMermaid(input: string): DiagramOut {
  const raw = input.split("\n").map((l) => l.trim()).filter(Boolean);
  const lines = raw.filter((l) => !/^(graph|flowchart)\s+/i.test(l) && !/^%%/.test(l));
  if (!lines.length) return { svg: "", error: "先输入 Mermaid 流程图，如：A[开始] --> B[结束]。" };
  const labels = new Map<string, string>();
  const shapes = new Map<string, "rect" | "diamond" | "circle">();
  const nodes: string[] = [];
  const edges: GEdge2[] = [];
  const nodeOf = (tok: string): string => {
    const m = /^([A-Za-z0-9_]+)\s*(?:\[(.*?)\]|\{(.*?)\}|\((.*?)\))?$/.exec(tok.trim());
    if (!m) return tok.trim();
    const id = m[1];
    uniqPush(nodes, id);
    const label = m[2] ?? m[3] ?? m[4];
    if (label) labels.set(id, label);
    if (m[3] !== undefined) shapes.set(id, "diamond");
    else if (m[4] !== undefined) shapes.set(id, "circle");
    else shapes.set(id, shapes.get(id) ?? "rect");
    return id;
  };
  for (const l of lines) {
    const parts = l.split(/--?>|---/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 1) {
      nodeOf(parts[0]);
      continue;
    }
    for (let i = 0; i + 1 < parts.length; i++) {
      let right = parts[i + 1];
      let w = "";
      const wm = /^\|([^|]*)\|\s*(.*)$/.exec(right);
      if (wm) {
        w = wm[1];
        right = wm[2];
      }
      const u = nodeOf(parts[i]);
      const v = nodeOf(right);
      if (u && v) edges.push({ u, v, w });
    }
  }
  if (!nodes.length) return { svg: "", error: "没有识别到 Mermaid 节点。" };
  // 分层：最长路径定层
  const level = new Map<string, number>(nodes.map((n) => [n, 0]));
  for (let iter = 0; iter < nodes.length; iter++) {
    for (const e of edges) {
      const nl = (level.get(e.u) ?? 0) + 1;
      if (nl > (level.get(e.v) ?? 0) && e.u !== e.v) level.set(e.v, nl);
    }
  }
  const byLevel = new Map<number, string[]>();
  nodes.forEach((n) => {
    const lv = level.get(n) ?? 0;
    const arr = byLevel.get(lv) ?? [];
    arr.push(n);
    byLevel.set(lv, arr);
  });
  const maxRow = Math.max(...[...byLevel.values()].map((a) => a.length));
  const W = Math.max(320, maxRow * 150 + 40);
  const pos: PosMap = new Map();
  byLevel.forEach((arr, lv) => {
    arr.forEach((n, i) => {
      pos.set(n, { x: (i + 1) * (W / (arr.length + 1)), y: lv * 96 + 44 });
    });
  });
  const H = Math.max(...[...level.values()]) * 96 + 92;
  let body = "";
  for (const e of edges) {
    const a = pos.get(e.u)!;
    const b = pos.get(e.v)!;
    body += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${LINE}" stroke-width="1.6" marker-end="url(#arr)"/>`;
    if (e.w) body += `<text x="${(a.x + b.x) / 2 + 4}" y="${(a.y + b.y) / 2}" font-size="11.5" fill="${MUT}">${esc(e.w)}</text>`;
  }
  for (const n of nodes) {
    const p = pos.get(n)!;
    const label = labels.get(n) ?? n;
    const shape = shapes.get(n) ?? "rect";
    if (shape === "diamond") {
      body += `<polygon points="${p.x},${p.y - 24} ${p.x + 62},${p.y} ${p.x},${p.y + 24} ${p.x - 62},${p.y}" fill="${FILL}" stroke="${ACCENT}" stroke-width="1.5"/>`;
    } else if (shape === "circle") {
      body += `<circle cx="${p.x}" cy="${p.y}" r="24" fill="${FILL}" stroke="${ACCENT}" stroke-width="1.5"/>`;
    } else {
      const wdt = Math.max(64, [...label].length * 13 + 26);
      body += `<rect x="${p.x - wdt / 2}" y="${p.y - 19}" width="${wdt}" height="38" rx="9" fill="${PAPER}" stroke="${ACCENT}" stroke-width="1.5"/>`;
    }
    body += `<text x="${p.x}" y="${p.y + 4.5}" text-anchor="middle" fill="${INK}">${esc(label)}</text>`;
  }
  return { svg: wrap(W, H, body, true), error: "" };
}

// ---------------------------------------------------------------- Graphviz (DOT) 子集
function buildDot(input: string): DiagramOut {
  const directed = /->/.test(input) || /digraph/i.test(input);
  const bodyText = input.replace(/^(di)?graph\s+\w*\s*\{/i, "").replace(/\}\s*$/, "");
  const stmts = bodyText.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  const nodes: string[] = [];
  const labels = new Map<string, string>();
  const edges: GEdge2[] = [];
  const labelOf = (stmt: string): string => {
    const m = /label\s*=\s*"([^"]*)"/.exec(stmt) ?? /label\s*=\s*([^\],]+)/.exec(stmt);
    return m ? m[1] : "";
  };
  const idOf = (tok: string): string => {
    const id = tok.replace(/\[.*\]$/, "").trim().replace(/^"|"$/g, "");
    if (id) uniqPush(nodes, id);
    return id;
  };
  for (const st of stmts) {
    if (/rankdir|node\s*\[|edge\s*\[|graph\s*\[/i.test(st)) continue;
    const em = /^(.+?)\s*(?:->|--)\s*(.+)$/.exec(st);
    if (em) {
      const u = idOf(em[1]);
      const v = idOf(em[2]);
      const w = labelOf(st);
      if (u && v) edges.push({ u, v, w });
    } else {
      const id = idOf(st);
      const lb = labelOf(st);
      if (id && lb) labels.set(id, lb);
    }
  }
  if (!nodes.length) return { svg: "", error: "先输入 DOT 图，如：digraph { A -> B }" };
  const W = 660;
  const H = 480;
  const laid = forceLayout(circleLayout(nodes, W, H), edges, W, H, 300);
  // DOT 的节点标签替换 id 显示：借 renderGraphSvg 的 nodes 顺序，用 label 作为显示名需要映射，这里直接以 id 显示
  void labels;
  return { svg: renderGraphSvg(nodes, edges, laid, { directed, w: W, h: H }), error: "" };
}

/** 解析 DOT 子集为交互模型（供画布拖拽用） */
export function parseDotInput(input: string): { nodes: string[]; edges: GEdge2[]; directed: boolean } {
  const directed = /->/.test(input) || /digraph/i.test(input);
  const bodyText = input.replace(/^(di)?graph\s+\w*\s*\{/i, "").replace(/\}\s*$/, "");
  const stmts = bodyText.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  const nodes: string[] = [];
  const edges: GEdge2[] = [];
  const idOf = (tok: string): string => {
    const id = tok.replace(/\[.*\]$/, "").trim().replace(/^"|"$/g, "");
    if (id) uniqPush(nodes, id);
    return id;
  };
  for (const st of stmts) {
    if (/rankdir|node\s*\[|edge\s*\[|graph\s*\[/i.test(st)) continue;
    const em = /^(.+?)\s*(?:->|--)\s*(.+)$/.exec(st);
    if (em) {
      const u = idOf(em[1]);
      const v = idOf(em[2]);
      const wm = /label\s*=\s*"([^"]*)"/.exec(st);
      if (u && v) edges.push({ u, v, w: wm ? wm[1] : "" });
    } else idOf(st);
  }
  return { nodes, edges, directed };
}
