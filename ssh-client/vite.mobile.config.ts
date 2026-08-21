import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// 手机伴侣独立构建（docs/actions/260821-mobile-companion.md 阶段 1）：
// 产物落 dist-mobile/，由 Tauri 进程内嵌的 axum 服务托管（rust-embed，
// debug 从磁盘实时读取，release 编译期内嵌）。不与桌面 dist/ 混装。
// 以 mobile/ 为 vite root：入口 index.html 平铺落进 dist-mobile/，
// 与 axum 静态兜底的 index.html 约定一致
export default defineConfig({
  root: resolve(process.cwd(), "mobile"),
  plugins: [react()],
  // 手机伴侣专属静态资源（manifest/图标）；不拷贝桌面 public/（tauri.svg 等）
  publicDir: resolve(process.cwd(), "mobile/public"),
  build: {
    outDir: resolve(process.cwd(), "dist-mobile"),
    emptyOutDir: true,
  },
});
