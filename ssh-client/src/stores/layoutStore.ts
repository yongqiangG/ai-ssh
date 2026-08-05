import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarView = "servers" | "files" | "sftp" | "local";

/** 中间工作区视图：终端 ⇄ SFTP（点 ActivityBar sftp 按钮切换） */
export type CenterView = "terminal" | "sftp" | "local";

export const MIN_LEFT_WIDTH = 220;
export const MAX_LEFT_WIDTH = 560;
export const MIN_RIGHT_WIDTH = 300;
export const MAX_RIGHT_WIDTH = 760;
export const DEFAULT_LEFT_WIDTH = 280;
export const DEFAULT_RIGHT_WIDTH = 380;

interface LayoutState {
  /** LeftSidebar（不含 ActivityBar 固定 48px）的宽度。 */
  leftWidth: number;
  /** 右侧 AI 面板的宽度。 */
  rightWidth: number;

  /** ActivityBar + LeftSidebar 共同显隐（Header 折叠按钮控制）。 */
  showSidebar: boolean;
  /** 中间终端面板显隐。 */
  showTerminal: boolean;
  /** 右侧 AI 面板显隐。 */
  showAiPanel: boolean;

  /** LeftSidebar 当前激活的视图。 */
  activeSidebarView: SidebarView;
  /** 中间工作区当前视图（终端 / SFTP）。 */
  centerView: CenterView;
  /**
   * 一次性注意力信号（不持久化）：跳转目标面板本就展开时，四个 layout 写入
   * 全幂等、界面零变化，「点了没反应」——由目标面板消费此信号播高亮脉冲后自清。
   */
  attentionPulse: "servers" | null;

  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  /**
   * 拖拽回调：直接基于 store 内部最新宽度做增量，避免 React 闭包
   * 捕获旧 leftWidth 导致拖拽不连贯。
   */
  applyLeftDrag: (dx: number) => void;
  /** 右栏贴右：dx > 0 表示鼠标右移，应当缩小宽度。 */
  applyRightDrag: (dx: number) => void;
  toggleSidebar: () => void;
  /** 直接设置侧栏显隐（chat 警示条跳转连接面板时强制展开用） */
  setShowSidebar: (v: boolean) => void;
  toggleTerminal: () => void;
  /** 直接设置终端面板显隐（命令卡片「执行」后强制显示终端用） */
  setShowTerminal: (v: boolean) => void;
  toggleAiPanel: () => void;
  /** 直接设置 AI 面板显隐（报错诊断气泡直接发送提问时强制展开用） */
  setShowAiPanel: (v: boolean) => void;
  setActiveSidebarView: (v: SidebarView) => void;
  /** 切换中间工作区视图（终端 ⇄ SFTP） */
  setCenterView: (v: CenterView) => void;
  /** 请求目标面板播一次注意力脉冲（chat 未连接卡片跳转时用） */
  pulseAttention: (target: "servers") => void;
  /** 目标面板播完脉冲后自清 */
  clearAttentionPulse: () => void;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftWidth: DEFAULT_LEFT_WIDTH,
      rightWidth: DEFAULT_RIGHT_WIDTH,
      showSidebar: true,
      showTerminal: true,
      showAiPanel: true,
      activeSidebarView: "servers",
      centerView: "terminal",
      attentionPulse: null,

      setLeftWidth: (w) =>
        set({ leftWidth: clamp(w, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH) }),
      setRightWidth: (w) =>
        set({ rightWidth: clamp(w, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH) }),
      applyLeftDrag: (dx) =>
        set((s) => ({
          leftWidth: clamp(s.leftWidth + dx, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH),
        })),
      applyRightDrag: (dx) =>
        set((s) => ({
          rightWidth: clamp(s.rightWidth - dx, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH),
        })),
      toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),
      setShowSidebar: (v) => set({ showSidebar: v }),
      toggleTerminal: () => set((s) => ({ showTerminal: !s.showTerminal })),
      setShowTerminal: (v) => set({ showTerminal: v }),
      toggleAiPanel: () => set((s) => ({ showAiPanel: !s.showAiPanel })),
      setShowAiPanel: (v) => set({ showAiPanel: v }),
      setActiveSidebarView: (v) => set({ activeSidebarView: v }),
      setCenterView: (v) => set({ centerView: v }),
      pulseAttention: (target) => set({ attentionPulse: target }),
      clearAttentionPulse: () => set({ attentionPulse: null }),
    }),
    {
      name: "ai-ssh:layout",
      partialize: (s) => ({
        leftWidth: s.leftWidth,
        rightWidth: s.rightWidth,
        showSidebar: s.showSidebar,
        showTerminal: s.showTerminal,
        showAiPanel: s.showAiPanel,
        activeSidebarView: s.activeSidebarView,
        centerView: s.centerView,
      }),
    }
  )
);
