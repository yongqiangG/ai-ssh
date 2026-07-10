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
    editorBg: "#0a0b10",
    sidebarBg: "#0e0f16",
    titlebarBg: "#12131c",
    panelHeaderBg: "#111219",
    activityBarBg: "#0c0d13",
    inputBg: "#161826",
    listHover: "rgba(255, 255, 255, 0.05)",
    listActive: "rgba(255, 255, 255, 0.09)",
    listSelected: "rgba(94, 106, 210, 0.2)",
    splitter: "#191b26",
    splitterHover: "#5e6ad2",

    border: "rgba(255, 255, 255, 0.07)",
    borderStrong: "rgba(255, 255, 255, 0.16)",

    fg: "#c8cad4",
    fgStrong: "#f2f3f7",
    fgMuted: "#9298a6",
    fgFaint: "#7b8294",

    accent: "#5e6ad2",
    accentHover: "#707cdf",
    accentFg: "#ffffff",

    green: "#4ade80",
    yellow: "#fbbf24",
    red: "#f87171",
    blue: "#60a5fa",
    purple: "#c084fc",

    terminalBg: "#0a0b10",
    terminalFg: "#d2d6e0",
    terminalPrompt: "#4ade80",
    terminalCursor: "#aab0c0",

    secondaryBg: "rgba(255, 255, 255, 0.07)",
    secondaryBgHover: "rgba(255, 255, 255, 0.12)",
    bubbleAiBg: "#141624",
    avatarAiBg: "rgba(94, 106, 210, 0.22)",
    avatarUserBg: "rgba(96, 165, 250, 0.16)",
    avatarNeutralBg: "rgba(255, 255, 255, 0.08)",
    dangerBg: "rgba(248, 113, 113, 0.14)",
    dangerBorder: "rgba(248, 113, 113, 0.45)",
    errorBg: "rgba(248, 113, 113, 0.12)",
    scrollbarThumb: "rgba(255, 255, 255, 0.14)",
    scrollbarThumbHover: "rgba(255, 255, 255, 0.24)",
    modalOverlay: "rgba(4, 5, 12, 0.6)",
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
    listSelected: "rgba(94, 106, 210, 0.18)",
    splitter: "#e0e0e0",
    splitterHover: "#5e6ad2",

    border: "#e0e0e0",
    borderStrong: "#c4c4c4",

    fg: "#323232",
    fgStrong: "#000000",
    fgMuted: "#6c6c6c",
    fgFaint: "#646b78",

    accent: "#4c56b8",
    accentHover: "#5e6ad2",
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
    bubbleAiBg: "#eceef5",
    avatarAiBg: "rgba(94, 106, 210, 0.15)",
    avatarUserBg: "#d4e3f5",
    avatarNeutralBg: "#e5e5e5",
    dangerBg: "#fde7e7",
    dangerBorder: "#f1aeb6",
    errorBg: "rgba(215, 58, 73, 0.1)",
    scrollbarThumb: "#c0c0c0",
    scrollbarThumbHover: "#a6a6a6",
    modalOverlay: "rgba(15, 17, 30, 0.4)",
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
