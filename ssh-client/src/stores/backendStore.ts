import { create } from "zustand";
import {
  getBaseUrl,
  pingBackend,
  setBaseUrl as persistBaseUrl,
} from "../api/request";

/** 「测试连接」的 UI 状态机 */
export type BackendTestStatus = "idle" | "testing" | "success" | "fail";

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
  /** 设置地址：同步写 state + localStorage */
  setBaseUrl: (url: string) => void;
  /** 用传入 url 测试后端可达性（不要求先保存） */
  testConnection: (url: string) => Promise<void>;
  /** 清回 idle（输入变化时调用，避免显示陈旧结果） */
  resetTest: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useBackendStore = create<BackendState>((set) => ({
  baseUrl: getBaseUrl(),
  testStatus: "idle",
  testMessage: null,

  setBaseUrl: (url) => {
    const trimmed = url.trim();
    persistBaseUrl(trimmed);
    set({ baseUrl: trimmed });
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
