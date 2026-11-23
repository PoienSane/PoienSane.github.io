/**
 * 题解质量检查（结构层，和 lint.ts 的行内规范分工不同）：
 * 章节是否齐全、标题层级是否跳级、代码围栏是否闭合、引用链接是否定义、
 * 图片是否写全、连续空行是否过多。formatDocument 提供一键整理。
 */

export interface QIssue {
  id: string;
  line: number; // 0-based
  message: string;
}

export function checkQuality(text: string): QIssue[] {
  const issues: QIssue[] = [];
  const lines = text.split("\n");

  // 章节完整性（有正文才查，避免空文档刷屏）
  if (text.trim().length > 80) {
    if (!/(思路|分析|题意|算法)/.test(text)) issues.push({ id: "sec-idea", line: 0, message: "缺少「思路 / 分析」章节：先讲为什么这样做。" });
    if (!/(复杂度)/.test(text)) issues.push({ id: "sec-cx", line: 0, message: "缺少「复杂度」章节：时间、空间复杂度各写一行。" });
    if (!/(证明|正确性|推导|归纳)/.test(text)) issues.push({ id: "sec-proof", line: 0, message: "建议补「正确性证明」：哪怕三五行，也要说明算法为什么对。" });
    if (!/```/.test(text)) issues.push({ id: "sec-code", line: 0, message: "还没有代码块：一篇题解通常以参考代码收尾。" });
  }

  // 标题层级跳跃
  let prev = 0;
  lines.forEach((l, i) => {
    const h = /^ {0,3}(#{1,6})\s/.exec(l);
    if (!h) return;
    const lv = h[1].length;
    if (prev && lv > prev + 1) {
      issues.push({ id: "h-jump-" + i, line: i, message: `标题层级从 H${prev} 直接跳到 H${lv}，中间缺了一级。` });
    }
    prev = lv;
  });

  // 代码围栏未闭合
  let fenceCh = "";
  let fenceLen = 0;
  let fenceLine = -1;
  lines.forEach((l, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (!m) return;
    if (!fenceCh) {
      fenceCh = m[1][0];
      fenceLen = m[1].length;
      fenceLine = i;
    } else if (m[1][0] === fenceCh && m[1].length >= fenceLen && /^ {0,3}(`{3,}|~{3,})\s*$/.test(l)) {
      fenceCh = "";
      fenceLine = -1;
    }
  });
  if (fenceCh) {
    issues.push({ id: "fence-open", line: fenceLine, message: "代码块没有闭合：找不到结束的 ``` 。" });
  }

  // 引用式链接未定义
  const defs = new Set<string>();
  for (const m of text.matchAll(/^\[([^\]]+)\]:\s*\S+/gm)) defs.add(m[1].toLowerCase());
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\[([^\]]+)\]\[([^\]]+)\]/g)) {
      if (!defs.has(m[2].toLowerCase())) {
        issues.push({ id: `ref-${i}-${m[2]}`, line: i, message: `引用链接 [${m[2]}] 没有定义，渲染后会变成死链。` });
      }
    }
  });

  // 图片问题
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/!\[([^\]]*)\]\(([^)]*)\)/g)) {
      if (!m[2].trim()) issues.push({ id: `img-${i}-u`, line: i, message: "图片地址为空。" });
      else if (!m[1].trim()) issues.push({ id: `img-${i}-a`, line: i, message: "图片没有写说明文字（alt），图挂了读者就看不懂。" });
    }
  });

  // 连续空行
  let blank = 0;
  lines.forEach((l, i) => {
    if (l.trim() === "") {
      blank++;
      if (blank === 3) issues.push({ id: "blank-" + i, line: i, message: "连续空行超过两行，可用「一键整理」合并。" });
    } else blank = 0;
  });

  return issues;
}

/** 一键整理：合并多余空行、去行尾空格、修正标题跳级、保证文末换行 */
export function formatDocument(text: string): { text: string; changed: number } {
  let changed = 0;
  const lines = text.split("\n");
  const out: string[] = [];
  let blank = 0;
  let prevLevel = 0;
  for (const raw of lines) {
    let line = raw.replace(/[ \t]+$/, "");
    if (line !== raw) changed++;
    if (line.trim() === "") {
      blank++;
      if (blank > 2) {
        changed++;
        continue;
      }
      out.push("");
      continue;
    }
    blank = 0;
    const h = /^( {0,3})(#{1,6})(\s+.*)$/.exec(line);
    if (h) {
      let lv = h[2].length;
      if (prevLevel && lv > prevLevel + 1) {
        lv = prevLevel + 1;
        changed++;
        line = h[1] + "#".repeat(lv) + h[3];
      }
      prevLevel = lv;
    }
    out.push(line);
  }
  let res = out.join("\n");
  if (!res.endsWith("\n")) {
    res += "\n";
    changed++;
  }
  return { text: res, changed };
}
