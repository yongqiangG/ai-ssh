import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light";

/**
 * 完整调色板。CSS 端通过 [data-theme="dark|light"] 规则同步维护同名
 * CSS 变量；JS 端（如终端组件）可直接读取 palette 字段，避免
 * 从 CSS 变量反查颜色值。
 *
 * 字段名与 index.css 中的 --vsc-* / --terminal-* 变量一一对应，
 * 新增颜色时务必两侧同步。
 */
export interface ThemePalette {
  editorBg: string;
  sidebarBg: string;
  titlebarBg: string;
  panelHeaderBg: string;
  activityBarBg: string;
  inputBg: string;
  listHover: string;
  listActive: string;
  listSelected: string;
  splitter: string;
  splitterHover: string;

  border: string;
  borderStrong: string;

  fg: string;
  fgStrong: string;
  fgMuted: string;
  fgFaint: string;

  accent: string;
  accentHover: string;
  accentFg: string;

  green: string;
  yellow: string;
  red: string;
  blue: string;
  purple: string;

  terminalBg: string;
  terminalFg: string;
  terminalPrompt: string;
  terminalCursor: string;

  /** 次级按钮 / 残废态背景。 */
  secondaryBg: string;
  secondaryBgHover: string;
  /** 聊天气泡：AI 侧背景。 */
  bubbleAiBg: string;
  /** 头像底色：AI / 用户 / 中性。 */
  avatarAiBg: string;
  avatarUserBg: string;
  avatarNeutralBg: string;
  /** 危险动作 hover 背景 / 描边。 */
  dangerBg: string;
  dangerBorder: string;
  /** 错误提示淡红底（带 alpha）。 */
  errorBg: string;
  /** 滚动条滑块。 */
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  /** 模态遮罩。 */
  modalOverlay: string;
}

export const PALETTES: Record<ThemeMode, ThemePalette> = {
  dark: {
    editorBg: "#1e1e1e",
    sidebarBg: "#252526",
    titlebarBg: "#323233",
    panelHeaderBg: "#2d2d2d",
    activityBarBg: "#333333",
    inputBg: "#3c3c3c",
    listHover: "#2a2d2e",
    listActive: "#37373d",
    listSelected: "#04395e",
    splitter: "#2b2b2b",
    splitterHover: "#0e639c",

    border: "#2b2b2b",
    borderStrong: "#454545",

    fg: "#cccccc",
    fgStrong: "#ffffff",
    fgMuted: "#969696",
    fgFaint: "#6e6e6e",

    accent: "#0e639c",
    accentHover: "#1177bb",
    accentFg: "#ffffff",

    green: "#4ec9b0",
    yellow: "#dcdcaa",
    red: "#f48771",
    blue: "#569cd6",
    purple: "#c586c0",

    terminalBg: "#1e1e1e",
    terminalFg: "#d4d4d4",
    terminalPrompt: "#4ec9b0",
    terminalCursor: "#aeafad",

    secondaryBg: "#3a3d41",
    secondaryBgHover: "#45494e",
    bubbleAiBg: "#2d2d2d",
    avatarAiBg: "#2a4a3f",
    avatarUserBg: "#1f3a5a",
    avatarNeutralBg: "#3a3d41",
    dangerBg: "#5a1d1d",
    dangerBorder: "#5a1d1d",
    errorBg: "rgba(244, 135, 113, 0.12)",
    scrollbarThumb: "#424242",
    scrollbarThumbHover: "#4f4f4f",
    modalOverlay: "rgba(0, 0, 0, 0.5)",
  },
  light: {
    editorBg: "#ffffff",
    sidebarBg: "#f3f3f3",
    titlebarBg: "#dddddd",
    panelHeaderBg: "#e8e8e8",
    activityBarBg: "#2c2c2c",
    inputBg: "#ffffff",
    listHover: "#e8e8e8",
    listActive: "#d0d0d0",
    listSelected: "#cce5ff",
    splitter: "#e0e0e0",
    splitterHover: "#0066b8",

    border: "#e0e0e0",
    borderStrong: "#c4c4c4",

    fg: "#323232",
    fgStrong: "#000000",
    fgMuted: "#6c6c6c",
    fgFaint: "#999999",

    accent: "#0066b8",
    accentHover: "#0078d4",
    accentFg: "#ffffff",

    green: "#098658",
    yellow: "#b58900",
    red: "#d73a49",
    blue: "#005cc5",
    purple: "#6f42c1",

    terminalBg: "#ffffff",
    terminalFg: "#1e1e1e",
    terminalPrompt: "#098658",
    terminalCursor: "#333333",

    secondaryBg: "#e5e5e5",
    secondaryBgHover: "#d4d4d4",
    bubbleAiBg: "#f0f0f0",
    avatarAiBg: "#d4ebe4",
    avatarUserBg: "#d4e3f5",
    avatarNeutralBg: "#e5e5e5",
    dangerBg: "#fde7e7",
    dangerBorder: "#f1aeb6",
    errorBg: "rgba(215, 58, 73, 0.1)",
    scrollbarThumb: "#c0c0c0",
    scrollbarThumbHover: "#a6a6a6",
    modalOverlay: "rgba(0, 0, 0, 0.35)",
  },
};

interface ThemeState {
  mode: ThemeMode;
  palette: ThemePalette;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
  root.style.colorScheme = mode;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "dark",
      palette: PALETTES.dark,
      setMode: (mode) => {
        applyMode(mode);
        set({ mode, palette: PALETTES[mode] });
      },
      toggle: () => {
        const next: ThemeMode = get().mode === "dark" ? "light" : "dark";
        get().setMode(next);
      },
    }),
    {
      name: "ai-ssh:theme",
      partialize: (s) => ({ mode: s.mode }),
      onRehydrateStorage: () => (state) => {
        if (state) applyMode(state.mode);
      },
    }
  )
);

/** 启动时调用一次，确保 html 上 data-theme 与 store 一致。 */
export function initTheme() {
  applyMode(useThemeStore.getState().mode);
}
