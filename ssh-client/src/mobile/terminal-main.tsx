// 鸿蒙 rawfile 终端页入口（阶段 1 迁移）：只渲染 TaskView 终端层，无导航壳
// （项目/任务列表由原生 ArkUI 承担）。task 对象由 URL query 组装——原生壳
// 在 WebView URL 上注入 taskId/token/baseUrl，页面零 localStorage 依赖。
// 返回按钮的宿主是原生页（系统返回手势/顶栏），onBack 置空实现。

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TaskView } from "./TaskView";
import { bootstrapConfig } from "./bootstrap";
import type { Task } from "./api";
import "./mobile.css";

const cfg = bootstrapConfig();
const task: Task = {
  id: cfg.taskId,
  projectId: "",
  name: null,
  prompt: "",
  agent: "claude",
  permissionMode: "ask",
  status: "running",
  createdAt: Date.now(),
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TaskView task={task} onBack={() => {/* 宿主为原生页，返回走系统手势 */}} />
  </StrictMode>,
);
