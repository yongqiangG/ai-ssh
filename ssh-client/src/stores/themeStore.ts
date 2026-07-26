import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 「电路霓虹」世界只有深色（决议 260726），类型保留以便未来扩展。 */
export type ThemeMode = "dark";

/**
 * 完整调色板。CSS 端通过 :root / [data-theme="dark"] 规则同步维护同名
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
    editorBg: "#07080f",
    sidebarBg: "#0b0d17",
    titlebarBg: "#0d0f1b",
    panelHeaderBg: "#0c0e19",
    activityBarBg: "#090a12",
    inputBg: "#10131f",
    listHover: "rgba(158, 170, 255, 0.06)",
    listActive: "rgba(158, 170, 255, 0.1)",
    listSelected: "rgba(124, 92, 255, 0.22)",
    splitter: "#141728",
    splitterHover: "#00e5ff",

    border: "rgba(140, 160, 255, 0.1)",
    borderStrong: "rgba(140, 160, 255, 0.22)",

    fg: "#c6cbe0",
    fgStrong: "#f0f3ff",
    fgMuted: "#8a93b2",
    fgFaint: "#6a7394",

    accent: "#00e5ff",
    accentHover: "#4deeff",
    accentFg: "#041018",

    green: "#3dffa8",
    yellow: "#ffb020",
    red: "#ff4d6d",
    blue: "#5ca8ff",
    purple: "#7c5cff",

    terminalBg: "#07080f",
    terminalFg: "#ccd2e8",
    terminalPrompt: "#3dffa8",
    terminalCursor: "#00e5ff",

    secondaryBg: "rgba(140, 160, 255, 0.08)",
    secondaryBgHover: "rgba(140, 160, 255, 0.14)",
    bubbleAiBg: "#0d1020",
    avatarAiBg: "rgba(0, 229, 255, 0.12)",
    avatarUserBg: "rgba(255, 45, 149, 0.12)",
    avatarNeutralBg: "rgba(140, 160, 255, 0.1)",
    dangerBg: "rgba(255, 77, 109, 0.12)",
    dangerBorder: "rgba(255, 77, 109, 0.45)",
    errorBg: "rgba(255, 77, 109, 0.1)",
    scrollbarThumb: "rgba(140, 160, 255, 0.16)",
    scrollbarThumbHover: "rgba(140, 160, 255, 0.28)",
    modalOverlay: "rgba(3, 4, 10, 0.72)",
  },
};

interface ThemeState {
  mode: ThemeMode;
  palette: ThemePalette;
}

function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
  root.style.colorScheme = mode;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    () => ({
      mode: "dark" as ThemeMode,
      palette: PALETTES.dark,
    }),
    {
      name: "ai-ssh:theme",
      partialize: (s) => ({ mode: s.mode }),
      onRehydrateStorage: () => (state) => {
        // 历史版本可能持久化了 "light"，一律归位 dark
        if (state) applyMode("dark");
      },
    }
  )
);

/** 启动时调用一次，确保 html 上 data-theme 与 store 一致。 */
export function initTheme() {
  applyMode("dark");
}
