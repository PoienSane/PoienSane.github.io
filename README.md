# 墨序 · Markdown 题解编辑器

这是可直接通过 GitHub Actions 部署到 GitHub Pages 的完整源码项目。网站由 React + TypeScript + Vite 构建，构建结果输出到 `dist/`。

## 部署到 GitHub Pages

1. 将本压缩包解压。
2. 将解压后文件夹**里面的所有内容**上传到仓库根目录（不要把整个 `moxu-github-pages` 文件夹再套一层）。
3. 确认 `.github/workflows/deploy.yml` 也上传成功。它负责自动安装依赖、构建并部署网站。
4. 打开仓库 `Settings → Pages`，将 `Build and deployment → Source` 设置为 **GitHub Actions**。
5. 打开仓库 `Actions` 标签页，等待 `Deploy MoXu to GitHub Pages` 工作流运行成功。
6. 访问 `https://你的用户名.github.io/`。

以后每次向 `main` 分支提交修改，GitHub Actions 都会自动重新构建并部署。

## 本地运行（可选）

需要安装 Node.js 22 或更高版本：

```bash
npm ci
npm run dev
```

构建：

```bash
npm run build
```

构建产物位于 `dist/`。项目使用 `vite-plugin-singlefile`，会将应用资源内联到构建后的 `dist/index.html`；这不影响源码仍由多个文件维护。

## 项目结构

```text
.github/workflows/deploy.yml  GitHub Pages 自动部署
src/                          React / TypeScript 源码
  App.tsx                     主界面与应用状态
  Editor.tsx                  Markdown 编辑器
  Preview.tsx                 实时预览
  commands.ts                 编辑命令
  index.css                   样式与主题
  lint.ts                     题解规范检查
  markdown.ts                 Markdown / 公式 / 代码渲染
  mathre.ts                   数学公式处理
  templates.ts                题解模板
  main.tsx                    React 入口
 test/                         单元测试
package.json                  依赖与命令
package-lock.json             锁定依赖版本
index.html                    Vite 页面入口
vite.config.ts                构建配置
```
