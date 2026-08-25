// 手机伴侣 API 层：同源 fetch（页面由 axum 服务自身托管），token 走 header。
// 响应封皮沿用全仓约定：成功码字符串 "0000"。

export interface Envelope<T> {
  code: string;
  info: string;
  data: T;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  branch: string | null;
  lastOpenedAt: number;
}

export interface Task {
  id: string;
  projectId: string;
  name: string | null;
  prompt: string;
  agent: string;
  permissionMode: string;
  status: string;
  createdAt: number;
  updatedAt?: number | null;
  failureReason?: string | null;
  claudeSessionId?: string | null;
  codexSessionId?: string | null;
}

export const TOKEN_KEY = "ai-ssh:mobile:token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { "X-Companion-Token": getToken() },
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body || body.code !== "0000") {
    throw new ApiError(body?.code ?? String(res.status), body?.info ?? `HTTP ${res.status}`);
  }
  return body.data;
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "X-Companion-Token": getToken(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body || body.code !== "0000") {
    throw new ApiError(body?.code ?? String(res.status), body?.info ?? `HTTP ${res.status}`);
  }
  return body.data;
}

// 恢复已结束任务（260825）：服务端翻状态、起新进程（agent CLI 原生会话
// 续跑），返回翻转为 pending 的任务。cols/rows 为本机 fit 值——PTY 初始
// 尺寸以手机为准，WS 断开时服务端还原桌面尺寸。
export function resumeTask(taskId: string, cols: number, rows: number): Promise<Task> {
  return apiPost<Task>(`/api/tasks/${encodeURIComponent(taskId)}/resume`, { cols, rows });
}

export async function checkHealth(): Promise<boolean> {
  try {
    await fetch("/api/health");
    return true;
  } catch {
    return false;
  }
}
