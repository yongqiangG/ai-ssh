import { create } from "zustand";
import {
  getBaseUrl,
  pingBackend,
  setBaseUrl as persistBaseUrl,
} from "../api/request";

/** 「测试连接」的 UI 状态机 */
export type BackendTestStatus = "idle" | "testing" | "success" | "fail";
export type BackendReadyStatus = "checking" | "ready" | "fail";

// 60s：打包单体时低配机器上 JVM sidecar 冷启动可能较慢，放宽等待窗口
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_READY_INTERVAL_MS = 600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface BackendState {
  /**
   * 后端基地址；"" 表示开发环境走 vite 代理。
   * 底层数据源为 localStorage（`ai-ssh:baseUrl`），此处仅作 React 订阅镜像。
   */
  baseUrl: string;
  /** 测试连接状态 */
  testStatus: BackendTestStatus;
  /** 失败时的错误信息 */
  testMessage: string | null;
  /** sidecar 后端就绪状态，业务数据加载必须等待它 ready */
  readyStatus: BackendReadyStatus;
  readyMessage: string | null;
  /** 设置地址：同步写 state + localStorage */
  setBaseUrl: (url: string) => void;
  /** 等待 sidecar 后端就绪，成功后再加载业务数据 */
  waitForReady: (timeoutMs?: number, intervalMs?: number) => Promise<void>;
  /** 用传入 url 测试后端可达性（不要求先保存） */
  testConnection: (url: string) => Promise<void>;
  /** 清回 idle（输入变化时调用，避免显示陈旧结果） */
  resetTest: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useBackendStore = create<BackendState>((set, get) => ({
  baseUrl: getBaseUrl(),
  testStatus: "idle",
  testMessage: null,
  readyStatus: "checking",
  readyMessage: null,

  setBaseUrl: (url) => {
    const trimmed = url.trim();
    persistBaseUrl(trimmed);
    set({ baseUrl: trimmed, readyStatus: "checking", readyMessage: null });
  },

  waitForReady: async (
    timeoutMs = DEFAULT_READY_TIMEOUT_MS,
    intervalMs = DEFAULT_READY_INTERVAL_MS
  ) => {
    const deadline = Date.now() + timeoutMs;
    let lastError: string | null = null;
    set({ readyStatus: "checking", readyMessage: null });

    while (Date.now() <= deadline) {
      try {
        await pingBackend(get().baseUrl);
        set({ readyStatus: "ready", readyMessage: null });
        return;
      } catch (e) {
        lastError = errMsg(e);
        await sleep(intervalMs);
      }
    }

    const message = lastError ?? "后端服务启动超时";
    set({ readyStatus: "fail", readyMessage: message });
    throw new Error(message);
  },

  testConnection: async (url) => {
    set({ testStatus: "testing", testMessage: null });
    try {
      await pingBackend(url.trim());
      set({ testStatus: "success", testMessage: null });
    } catch (e) {
      set({ testStatus: "fail", testMessage: errMsg(e) });
    }
  },

  resetTest: () => set({ testStatus: "idle", testMessage: null }),
}));
