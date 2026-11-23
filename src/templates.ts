export const SKELETON = `## 题意简述

给定一个长度为 $n$ 的整数序列 $a$，求其中任意两个不同位置上的数之和的最大值。

数据范围：$2 \\le n \\le 10^5$，$|a_i| \\le 10^9$。

## 思路分析

先考虑暴力做法：枚举所有数对 $(i,j)$，取和的最大值，时间复杂度为 $O(n^2)$，无法通过本题。

进一步观察可以发现，答案一定由序列中最大的两个数构成，只需要维护最大值和次大值即可。

## 正确性证明

设 $a_x$ 与 $a_y$ 为序列中最大的两个数。假设存在更优的数对 $(p,q)$，满足：

$$a_p + a_q > a_x + a_y$$

则 $a_p$ 与 $a_q$ 中至少有一个不在最大的两个数之中，将其替换为 $a_x$ 或 $a_y$ 后和不会变小，与假设矛盾。因此结论成立。

## 复杂度

- 时间复杂度为 $O(n)$。
- 空间复杂度为 $O(1)$。

## 参考代码

C++ 版本：

\`\`\`cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    scanf("%d", &n);
    long long m1 = LLONG_MIN, m2 = LLONG_MIN;
    for (int i = 0; i < n; i++) {
        long long x;
        scanf("%lld", &x);
        if (x > m1) m2 = m1, m1 = x;
        else if (x > m2) m2 = x;
    }
    printf("%lld\\n", m1 + m2);
    return 0;
}
\`\`\`

Python 版本：

\`\`\`py
n = int(input())
a = sorted(map(int, input().split()), reverse=True)
print(a[0] + a[1])
\`\`\`
`;

export const DEFAULT_DOC = `# P1000 最大二元和 题解

> 左边写 Markdown，右边实时渲染。点击底部状态栏可以查看规范检查结果，也可以一键修复。

## 思路

设序列为 $a_1, a_2, \\dots, a_n$，答案为：

$$\\max_{i \\ne j}\\left(a_i + a_j\\right)$$

只需要找出最大值与次大值，时间复杂度为 $O(n)$。当 $n \\le 10^5$ 时可以轻松通过。

也可以写成对齐形式（行间公式支持 aligned / cases / matrix 等环境）：

$$\begin{aligned}
\\operatorname{ans} &= \\max_{i<j}(a_i+a_j) \\
&= a_{(1)} + a_{(2)}
\\end{aligned}$$

行内公式有四种写法：$x$、\\(y\\)、$$z$$、\\[w\\]，渲染结果一致；常用宏 $\\R$、$\\N$、$\\Z$、$\\abs{x}$、$\\ceil{x}$ 可以直接用。

## 实现要点

1. 维护最大值与次大值
   - 只在 $x > m_1$ 时交换，避免重复计数
   - 复杂度 $O(1)$ 额外空间
2. 注意负数边界
   - 初值使用 LLONG_MIN（Python 里是 -10**18）
   - $n = 2$ 时也要正确

- [x] 读完题面并确认数据范围
- [ ] 补一组 $n=2$ 的手造数据
- [ ] 检查输出格式

## 代码

\`\`\`cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    scanf("%d", &n);
    long long m1 = LLONG_MIN, m2 = LLONG_MIN;
    for (int i = 0; i < n; i++) {
        long long x;
        scanf("%lld", &x);
        if (x > m1) m2 = m1, m1 = x;
        else if (x > m2) m2 = x;
    }
    printf("%lld\\n", m1 + m2);
}
\`\`\`

\`\`\`py
n = int(input())
a = sorted(map(int, input().split()), reverse=True)
print(a[0] + a[1])
\`\`\`

## 规范检查演示（可删除）

有$\\log$ 算法，这一句公式紧贴了中文。

有 $\\log$suanfa，这一句公式后面紧贴了英文。

我们用 $dfs$ 来搜索,当 n<=100 时直接暴力 O(n^2) 即可

## 参考文献

- 本题来自 [洛谷](https://www.luogu.com.cn/)。
- 公式使用 KaTeX 渲染。
`;

export interface SolutionTemplate {
  id: string;
  name: string;
  desc: string;
  body: string;
}

/** OI / ACM 题解模板库：按题型选骨架，插入后替换占位文字即可 */
export const STRESS = `## 对拍

下面三段代码依次是：数据生成器（从 stdin 读种子）、暴力做法、正解。
写好后点顶栏「对拍」，生成器会随机造很多组小数据，两份程序同数据运行比输出，不一致时自动给出反例。

### 数据生成器

\`\`\`cpp
#include <bits/stdc++.h>
using namespace std;
int main() {
    long long seed;
    if (!(cin >> seed)) seed = 1;
    mt19937 rng((unsigned)seed);
    int n = (int)(rng() % 8) + 1;
    cout << n << "\n";
    for (int i = 0; i < n; i++) {
        if (i) cout << ' ';
        cout << (int)(rng() % 20) + 1;
    }
    cout << "\n";
    return 0;
}
\`\`\`

### 暴力

\`\`\`cpp
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n;
    if (!(cin >> n)) return 0;
    long long ans = 0;
    for (int i = 0; i < n; i++) {
        long long x;
        cin >> x;
        ans += x;
    }
    cout << ans << "\n";
    return 0;
}
\`\`\`

### 正解（待测）

\`\`\`cpp
#include <bits/stdc++.h>
using namespace std;
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    long long ans = 0, x;
    while (cin >> x) ans += x;
    cout << ans << "\n";
    return 0;
}
\`\`\`
`;

export const SOLUTION_TEMPLATES: SolutionTemplate[] = [
  { id: "standard", name: "标准题解", desc: "题意 / 思路 / 证明 / 复杂度 / 代码", body: SKELETON },
  {
    id: "stress",
    name: "对拍脚手架",
    desc: "生成器 / 暴力 / 正解三段代码，配合顶栏「对拍」自动找反例",
    body: STRESS,
  },
  {
    id: "graph",
    name: "图论题解",
    desc: "建模 / 最短路或搜索 / 正确性 / 复杂度",
    body: `## 题意简述

给定一张 $n$ 个点、$m$ 条边的图，求源点 $s$ 到其余各点的最短路径。

## 建模

把题目中的对象抽象成图的顶点，把关系抽象成边：边 $(u,v,w)$ 表示从 $u$ 直接到 $v$ 的代价为 $w$。

## 算法

边权非负，使用 Dijkstra 算法：用优先队列维护当前候选点，每次取出距离最小的点松弛其出边。二叉搜索树的倍增跳跃可以写成 $\\operatorname{up}[k][v]$，最近公共祖先写成 $\\operatorname{lca}(u,v)$，函数名在公式中一律用 \`\\operatorname\` 直立排版。

## 正确性证明

设已确定最短距离的点集为 $S$。每次取出的点 $u$ 若还存在更短路径，则该路径第一次离开 $S$ 时经过的边权非负，距离不会小于 $\\operatorname{dist}[u]$，矛盾。因此贪心选择正确。

## 复杂度

- 时间复杂度为 $O((n + m) \\log n)$。
- 空间复杂度为 $O(n + m)$。

## 参考代码

在工具栏插入 C++ / Python 代码块后粘贴代码。
`,
  },
  {
    id: "dp",
    name: "动态规划题解",
    desc: "状态 / 转移 / 边界 / 答案 / 优化",
    body: `## 题意简述

给定一个长度为 $n$ 的序列，求满足条件的最优子结构所对应的最大值。

## 状态定义

设 $f[i]$ 表示只考虑前 $i$ 个元素时的最优答案。

## 状态转移

枚举最后一个被选中的元素 $j$，有：

$$f[i] = \\max_{j < i} \\left( f[j] + w(j, i) \\right)$$

## 边界与答案

初始状态为 $f[0] = 0$，最终答案为 $f[n]$。注意下标从 $0$ 还是从 $1$ 开始，全文保持一致。

## 优化

若转移满足决策单调性或斜率优化条件，可把时间复杂度从 $O(n^2)$ 优化到 $O(n \\log n)$ 乃至 $O(n)$，这里写清楚优化依据。

## 复杂度

- 时间复杂度为 $O(n^2)$。
- 空间复杂度为 $O(n)$。

## 参考代码

在工具栏插入 C++ / Python 代码块后粘贴代码。
`,
  },
  {
    id: "ds",
    name: "数据结构题解",
    desc: "维护信息 / 操作 / 合并 / 复杂度",
    body: `## 题意简述

给定一个长度为 $n$ 的序列，要求支持修改与区间查询。

## 维护的信息

每个节点维护以下信息：区间和 $\\operatorname{sum}$、最大值 $\\operatorname{mx}$ 与懒标记 $\\operatorname{tag}$。函数名在公式中一律用 \`\\operatorname\` 直立排版。

## 合并规则

父节点的信息由左右子节点合并得到：

$$\\operatorname{sum}(p) = \\operatorname{sum}(l) + \\operatorname{sum}(r)$$

## 操作流程

1. 下传懒标记，保证子节点信息最新。
2. 递归到目标区间后回溯更新。

## 复杂度

- 单次操作时间复杂度为 $O(\\log n)$。
- 空间复杂度为 $O(n)$。

## 参考代码

在工具栏插入 C++ / Python 代码块后粘贴代码。
`,
  },
  {
    id: "proof",
    name: "数学证明题解",
    desc: "命题 / 引理 / 证明 / 结论",
    body: `## 命题

对任意正整数 $n$，都有：

$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$

## 引理

先证明一个后面要用到的简单结论，并单独编号陈述。

## 证明

对 $n$ 使用数学归纳法。当 $n = 1$ 时命题显然成立。假设命题对 $n = k$ 成立，则对 $n = k + 1$ 有：

$$\\sum_{i=1}^{k+1} i = \\frac{k(k+1)}{2} + (k+1) = \\frac{(k+1)(k+2)}{2}$$

由数学归纳法知，命题对一切正整数 $n$ 成立。证毕。
`,
  },
  {
    id: "complexity",
    name: "复杂度分析片段",
    desc: "只插入一段复杂度分析",
    body: `## 复杂度分析

主循环共执行 $n$ 次，每次操作的时间复杂度为 $O(\\log n)$，预处理的时间复杂度为 $O(n \\log n)$。

- 时间复杂度为 $O(n \\log n)$。
- 空间复杂度为 $O(n)$。
`,
  },
];
