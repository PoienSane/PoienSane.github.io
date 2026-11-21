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
