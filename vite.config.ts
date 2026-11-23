import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  // 允许在预览域名（如 *.e2b.app）下访问开发服务器
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: false,
  },
  preview: { allowedHosts: true },
  // 强制 ASCII 输出：KaTeX 词法正则含 U+202A-U+D7FF 等 Unicode 范围，
  // 若以字面字符写入单文件 HTML，被某些平台转码后会损坏成
  // “Range out of order in character class”，导致所有公式报错。
  esbuild: { charset: "ascii" },
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    // 单文件构建：把字体等资源全部内联，离线也能正常显示
    assetsInlineLimit: 4 * 1024 * 1024,
    cssCodeSplit: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
