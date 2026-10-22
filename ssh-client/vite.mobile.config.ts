import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// 手机伴侣独立构建（docs/actions/260821-mobile-companion.md 阶段 1）：
// 产物落 dist-mobile/，由 Tauri 进程内嵌的 axum 服务托管（rust-embed，
// debug 从磁盘实时读取，release 编译期内嵌）。不与桌面 dist/ 混装。
// 以 mobile/ 为 vite root：入口 index.html 平铺落进 dist-mobile/，
// 与 axum 静态兜底的 index.html 约定一致

// terminal.html 走 resource://rawfile（origin null），子资源加载被 CORS 拦
// （261019 黑屏根因）——仅 terminal 入口用 singlefile 内联为自包含单文件。
// vite-plugin-singlefile 是全构建级插件（无入口过滤），这里用环境变量切两遍
// 构建：HARMONY_TERMINAL=1 时只建 terminal 入口并内联；正常构建两入口照旧，
// sync 脚本从单文件构建产物拷 terminal.html（index.html 不经过 singlefile）。
function terminalOnlySingleFile(): Plugin[] {
  if (process.env.HARMONY_TERMINAL !== "1") {
    return [];
  }
  return [
    viteSingleFile(),
    {
      name: "harmony-terminal-input",
      config(cfg) {
        cfg.build ??= {};
        cfg.build.outDir = resolve(process.cwd(), "dist-mobile-terminal");
        cfg.build.rollupOptions ??= {};
        cfg.build.rollupOptions.input = {
          terminal: resolve(process.cwd(), "mobile/terminal.html"),
        };
      },
    },
  ];
}

export default defineConfig({
  root: resolve(process.cwd(), "mobile"),
  plugins: [react(), ...terminalOnlySingleFile()],
  // 相对路径 base：terminal.html 经 resource://rawfile/terminal/ 加载时，
  // 绝对路径 /assets 会解析到资源协议根而 404（黑屏根因）；web 伴侣不受影响
  // （hash 路由永远在根路径，./assets === /assets）
  base: "./",
  // 手机伴侣专属静态资源（manifest/图标）；不拷贝桌面 public/（tauri.svg 等）
  publicDir: resolve(process.cwd(), "mobile/public"),
  build: {
    outDir: resolve(process.cwd(), "dist-mobile"),
    emptyOutDir: true,
    rollupOptions: {
      // 双入口（正常构建）：index.html = web 伴侣整页（axum 托管）；
      // terminal.html = 鸿蒙 rawfile 终端页源（无导航壳，query 注入）。
      // input 显式列出后覆盖 vite 默认，index 必须在列，否则 web 伴侣产物消失
      input: {
        index: resolve(process.cwd(), "mobile/index.html"),
        terminal: resolve(process.cwd(), "mobile/terminal.html"),
      },
    },
  },
});
