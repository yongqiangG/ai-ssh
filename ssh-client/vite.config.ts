import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    proxy: {
      // 开发环境：客户端 baseURL 为空字符串，请求 /api/* 由 vite 代理到 dev 后端。
      // 8092 = dev 沙盒端口（260825：后端经 ssh-server/scripts/dev-backend.cmd 起，
      // 与常驻安装版的 sidecar 8091 分流，杜绝 dev 前端悄悄打到安装版的库）
      "/api": {
        target: "http://localhost:8092",
        changeOrigin: true,
      },
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
