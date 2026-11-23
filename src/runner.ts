/**
 * C++ 在线编译运行：Judge0（主，GCC 14）→ Wandbox（备，GCC 13）自动切换。
 * 两家接口都允许跨域；纯函数（代码块提取、结果解析、输出对比）与网络部分分开，方便测试。
 * 代码只发给编译服务执行，本模块不做任何本地缓存与上报。
 */

export interface CodeBlockInfo {
  lang: string;
  code: string;
  /** 开 ``` 所在行（0 起） */
  startLine: number;
  /** 闭 ``` 所在行（0 起） */
  endLine: number;
  /** 开 ``` 的字符偏移 */
  start: number;
  /** 闭 ``` 行末的字符偏移（不含换行） */
  end: number;
}

/** 扫描文档里的围栏代码块（``` 或 ~~~），返回语言、内容与位置 */
export function extractCodeBlocks(src: string): CodeBlockInfo[] {
  const lines = src.split("\n");
  const blocks: CodeBlockInfo[] = [];
  let offset = 0;
  let open: { lang: string; startLine: number; start: number; buf: string[] } | null = null;
  lines.forEach((line, i) => {
    const lineStart = offset;
    offset += line.length + 1;
    const fence = /^\s{0,3}(```+|~~~+)\s*([^\s`~]*)/.exec(line);
    if (!open) {
      if (fence) open = { lang: fence[2].toLowerCase(), startLine: i, start: lineStart, buf: [] };
    } else if (/^\s{0,3}(```+|~~~+)\s*$/.test(line)) {
      blocks.push({ lang: open.lang, code: open.buf.join("\n"), startLine: open.startLine, endLine: i, start: open.start, end: lineStart + line.length });
      open = null;
    } else {
      open.buf.push(line);
    }
  });
  return blocks;
}

export function isCppLang(lang: string): boolean {
  return ["cpp", "c++", "cc", "cxx", "c", "h", "hpp", "hxx"].includes((lang || "").trim().toLowerCase());
}

export function isPlainLang(lang: string): boolean {
  const l = (lang || "").trim().toLowerCase();
  return l === "" || ["text", "txt", "plain", "input", "output", "in", "out", "data"].includes(l);
}

export interface RunResult {
  /** ok=正常退出；compile=编译错误；runtime=运行时错误；timeout=超时；network=服务不可达 */
  stage: "ok" | "compile" | "runtime" | "timeout" | "network";
  stdout: string;
  stderr: string;
  /** 编译器输出（警告等）；编译失败时这里就是报错全文 */
  compileLog: string;
  /** 形如 "Judge0 · GCC 14.1.0" */
  provider: string;
  timeMs?: number;
  message?: string;
}

/** 对答案：逐行比对，忽略行尾空白与文末空行（与 OI 评测的通常口径一致） */
export function compareOutputs(actual: string, expected: string): { match: boolean; firstDiff: number | null } {
  const norm = (s: string) =>
    s
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/g, ""));
  const a = norm(actual);
  const b = norm(expected);
  while (a.length && a[a.length - 1] === "") a.pop();
  while (b.length && b[b.length - 1] === "") b.pop();
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { match: false, firstDiff: i };
  }
  return { match: true, firstDiff: null };
}

// ---------------------------------------------------------------- 编码工具
export function b64EncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function b64DecodeUtf8(s: string): string {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- Judge0
const JUDGE0_LANG = 105; // C++ (GCC 14.1.0)
const JUDGE0_NAME = "Judge0 · GCC 14.1.0";

export function judge0Body(code: string, stdin: string): Record<string, unknown> {
  return { language_id: JUDGE0_LANG, source_code: b64EncodeUtf8(code), stdin: b64EncodeUtf8(stdin) };
}

interface Judge0Response {
  status?: { id: number; description?: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  token?: string;
}

export function parseJudge0(j: Judge0Response): RunResult {
  const dec = (v?: string | null) => (v ? b64DecodeUtf8(v) : "");
  const id = j.status?.id ?? 0;
  const base = { stdout: dec(j.stdout), stderr: dec(j.stderr), compileLog: dec(j.compile_output), provider: JUDGE0_NAME, timeMs: j.time ? Math.round(parseFloat(j.time) * 1000) : undefined };
  if (id === 3 || id === 4) return { ...base, stage: "ok" };
  if (id === 6) return { ...base, stage: "compile" };
  if (id === 5) return { ...base, stage: "timeout", message: "运行超时" };
  if (id === 1 || id === 2) return { ...base, stage: "network", message: "编译服务还在排队" };
  return { ...base, stage: "runtime", message: j.status?.description || "运行时错误" };
}

// ---------------------------------------------------------------- Wandbox
const WANDBOX_NAME = "Wandbox · GCC 13.2.0";

export function wandboxBody(code: string, stdin: string, compiler = "gcc-13.2.0"): Record<string, unknown> {
  return { compiler, code, stdin, "compiler-option-raw": "-std=c++17\n-O2\n-Wall" };
}

interface WandboxResponse {
  status?: string;
  signal?: string;
  compiler_output?: string;
  compiler_error?: string;
  program_output?: string;
  program_error?: string;
}

export function parseWandbox(j: WandboxResponse): RunResult {
  const compileLog = (j.compiler_error ?? "") + (j.compiler_output ?? "");
  const stdout = j.program_output ?? "";
  const stderr = j.program_error ?? "";
  const compileFailed = /error:/i.test(compileLog) && stdout === "" && stderr === "" && !j.signal;
  if (compileFailed) return { stage: "compile", stdout, stderr, compileLog, provider: WANDBOX_NAME };
  if (j.signal) return { stage: "runtime", stdout, stderr: stderr || `进程被信号 ${j.signal} 终止`, compileLog, provider: WANDBOX_NAME, message: `信号 ${j.signal}` };
  if (j.status === "0") return { stage: "ok", stdout, stderr, compileLog, provider: WANDBOX_NAME };
  return { stage: "runtime", stdout, stderr, compileLog, provider: WANDBOX_NAME, message: `退出码 ${j.status ?? "?"}` };
}

// ---------------------------------------------------------------- 网络层
async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function runViaJudge0(code: string, stdin: string): Promise<RunResult> {
  const first = (await fetchJson(
    "https://ce.judge0.com/submissions?base64_encoded=true&wait=true",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(judge0Body(code, stdin)) },
    60000,
  )) as Judge0Response;
  let cur = first;
  // wait=true 一般直接给结果；个别情况还在队列里，短轮询几次
  for (let k = 0; k < 12 && (cur.status?.id === 1 || cur.status?.id === 2) && cur.token; k++) {
    await new Promise((r) => setTimeout(r, 900));
    cur = (await fetchJson(`https://ce.judge0.com/submissions/${cur.token}?base64_encoded=true`, {}, 20000)) as Judge0Response;
  }
  if (cur.status?.id === 1 || cur.status?.id === 2) throw new Error("编译服务排队过久");
  return parseJudge0(cur);
}

async function runViaWandbox(code: string, stdin: string): Promise<RunResult> {
  const j = (await fetchJson(
    "https://wandbox.org/api/compile.json",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wandboxBody(code, stdin)) },
    60000,
  )) as WandboxResponse;
  return parseWandbox(j);
}

/** 编译并运行一段 C++：Judge0 优先，失败自动切 Wandbox；全失败返回 network 阶段与原因 */
export async function runCpp(code: string, stdin: string): Promise<RunResult> {
  const errors: string[] = [];
  try {
    return await runViaJudge0(code, stdin);
  } catch (e) {
    errors.push("Judge0：" + (e instanceof Error ? e.message : String(e)));
  }
  try {
    return await runViaWandbox(code, stdin);
  } catch (e) {
    errors.push("Wandbox：" + (e instanceof Error ? e.message : String(e)));
  }
  return {
    stage: "network",
    stdout: "",
    stderr: "",
    compileLog: "",
    provider: "无可用服务",
    message: "两个编译服务都没连上（需要联网）。" + errors.join("；"),
  };
}

/** 默认数据生成器：从 stdin 读一个整数种子，生成一组小数据，可直接改成你的题面 */
export const DEFAULT_GEN = `#include <bits/stdc++.h>
using namespace std;
int main() {
    long long seed;
    if (!(cin >> seed)) seed = 1;
    mt19937 rng((unsigned)seed);
    int n = (int)(rng() % 10) + 1;
    cout << n << "\\n";
    for (int i = 0; i < n; i++) {
        if (i) cout << ' ';
        cout << (int)(rng() % 20) + 1;
    }
    cout << "\\n";
    return 0;
}`;

export interface StressCodes {
  gen: string;
  a: string;
  b: string;
}

/**
 * 从文档里挑对拍三件套：三段以上 C++ 时按「生成器 / 标程 / 待测」顺序取前三段；
 * 两段时当作标程与待测、生成器用默认模板；一段时当作待测；没有时全空（生成器给模板）。
 */
export function pickStressCodes(src: string): StressCodes {
  const cpp = extractCodeBlocks(src).filter((b) => isCppLang(b.lang));
  if (cpp.length >= 3) return { gen: cpp[0].code, a: cpp[1].code, b: cpp[2].code };
  if (cpp.length === 2) return { gen: DEFAULT_GEN, a: cpp[0].code, b: cpp[1].code };
  if (cpp.length === 1) return { gen: DEFAULT_GEN, a: "", b: cpp[0].code };
  return { gen: DEFAULT_GEN, a: "", b: "" };
}
