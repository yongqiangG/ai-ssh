import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // 限制并行 worker 数：vitest 默认为每个测试文件 fork 一个独立 Node+jsdom
    // 进程（16 核机器上 6 个文件 = 7 个进程同时驻留），系统可用内存紧张时
    // 容易触发 OOM 崩溃。测试总量小（~5s），限到 2 几乎不影响速度。
    maxWorkers: 2,
  },
});
