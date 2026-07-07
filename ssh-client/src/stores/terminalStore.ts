/**
 * 终端 tab 状态 store（zustand）。
 *
 * ## zustand 快速理解（面向后端视角）
 * create() 返回一个 hook（useTerminalStore）。组件里 `useTerminalStore(s => s.tabs)`
 * 相当于「订阅 state 的一个切片」：切片变化时仅订阅它的组件重渲染。
 * set() 是唯一的写入口，要求不可变更新——总是生成新数组/新对象，而不是原地修改，
 * React 靠引用比较感知变化（类似把实体当值对象用，每次改动都换新实例）。
 *
 * ## 职责边界
 * 这里只存「可渲染的轻量状态」：tab 列表与激活项。
 * xterm 实例、轮询定时器等资源在 terminalManager（非 React 单例模块）里，
 * 两者协作方式：组件层调 manager 做事，manager 断连时经回调调本 store 的 markClosed。
 *
 * ## tab 生命周期
 * openTab → "opening"（后端会话建立中）→ markActive → "active"
 * → （断连：轮询 3 连错 / 后端 closed 标记 / 10s 心跳失败）markClosed → "closed"
 * → 再次 openTab 时回到 "opening"（组件层据此销毁旧实例重开，见 TerminalPanel）
 * 关闭 tab（closeTab）则整个移除。约定：关 tab 只关终端会话，不断开 SSH 连接。
 */
import { create } from "zustand";

export type TerminalTabStatus = "opening" | "active" | "closed";

export interface TerminalTab {
  /** 即 SSH 连接的 connectionId（一个连接同时最多一个终端 tab） */
  connectionId: string;
  /** 展示名（取连接名称） */
  name: string;
  status: TerminalTabStatus;
}

interface TerminalState {
  tabs: TerminalTab[];
  /** 当前显示的 tab（其余容器 visibility:hidden 堆叠在下面） */
  activeId: string | null;

  /** 打开/激活 tab：不存在则新建（opening）；已断连则置回 opening 触发重开；总是激活 */
  openTab: (connectionId: string, name: string) => void;
  setActive: (connectionId: string) => void;
  /** 后端会话建立成功（组件层在 manager.openTerminalIn 成功后调用） */
  markActive: (connectionId: string) => void;
  /** 断连标记（manager 回调 / open 失败），tab 保留供查看日志 */
  markClosed: (connectionId: string) => void;
  /** 移除 tab；若移除的是激活项，自动激活相邻 tab */
  closeTab: (connectionId: string) => void;
}

/** 不可变地更新单个 tab 的状态 */
function patchTab(
  tabs: TerminalTab[],
  connectionId: string,
  status: TerminalTabStatus
): TerminalTab[] {
  return tabs.map((t) => (t.connectionId === connectionId ? { ...t, status } : t));
}

export const useTerminalStore = create<TerminalState>((set) => ({
  tabs: [],
  activeId: null,

  openTab: (connectionId, name) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.connectionId === connectionId);
      if (!existing) {
        // 新建 tab，追加到末尾并激活
        return {
          tabs: [...s.tabs, { connectionId, name, status: "opening" }],
          activeId: connectionId,
        };
      }
      if (existing.status === "closed") {
        // 断连后重开：置回 opening，TerminalPanel 的 effect 会销毁旧实例重建
        return {
          tabs: patchTab(s.tabs, connectionId, "opening"),
          activeId: connectionId,
        };
      }
      // 已在打开中/活跃：仅激活
      return { activeId: connectionId };
    }),

  setActive: (connectionId) => set({ activeId: connectionId }),

  markActive: (connectionId) =>
    set((s) => ({ tabs: patchTab(s.tabs, connectionId, "active") })),

  markClosed: (connectionId) =>
    set((s) => ({ tabs: patchTab(s.tabs, connectionId, "closed") })),

  closeTab: (connectionId) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.connectionId === connectionId);
      const tabs = s.tabs.filter((t) => t.connectionId !== connectionId);
      let activeId = s.activeId;
      if (s.activeId === connectionId) {
        // 关闭的是当前 tab：激活相邻项（优先右侧，无则左侧），全空置 null
        activeId = tabs[Math.min(idx, tabs.length - 1)]?.connectionId ?? null;
      }
      return { tabs, activeId };
    }),
}));
