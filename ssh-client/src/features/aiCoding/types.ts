export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  /** 为 true 时不在左侧常驻竖条显示，仅可从首页或「展开全部」抽屉访问。缺省=常驻。 */
  hiddenFromRail?: boolean;
}

export type AgentType = "claude" | "codex";
/** aiCoding 固定深色单主题；类型保留以兼容迁移组件的 props 契约，取值恒为 "dark"。 */
export type ThemeMode = "dark";
export type ThemeVariant = "dark";
export type PermissionMode = "ask" | "auto_edit" | "full_access";
export type TaskDisplayWindow = 3 | 7 | 15 | 30 | "all";

export const TASK_DISPLAY_WINDOW_VALUES = [3, 7, 15, 30, "all"] as const;
export const DEFAULT_TASK_DISPLAY_WINDOW: TaskDisplayWindow = 3;

export function normalizeTaskDisplayWindow(value: unknown): TaskDisplayWindow {
  if (value === "all") return "all";
  const parsed = typeof value === "number" ? value : Number(value);
  return TASK_DISPLAY_WINDOW_VALUES.includes(parsed as TaskDisplayWindow)
    ? (parsed as TaskDisplayWindow)
    : DEFAULT_TASK_DISPLAY_WINDOW;
}

export type TerminalFontSize = number;

export const TERMINAL_FONT_SIZE_MIN = 10;
export const TERMINAL_FONT_SIZE_MAX = 20;
export const TERMINAL_FONT_SIZE_STEP = 1;
export const DEFAULT_TERMINAL_FONT_SIZE: TerminalFontSize = 12;

export function clampTerminalFontSize(value: number): TerminalFontSize {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_FONT_SIZE;
  const snapped = Math.round(value / TERMINAL_FONT_SIZE_STEP) * TERMINAL_FONT_SIZE_STEP;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, snapped));
}

export type TerminalScrollback = number;

export const TERMINAL_SCROLLBACK_MIN = 500;
export const TERMINAL_SCROLLBACK_MAX = 5000;
export const TERMINAL_SCROLLBACK_STEP = 500;
export const DEFAULT_TERMINAL_SCROLLBACK: TerminalScrollback = 1000;

export function clampTerminalScrollback(value: unknown): TerminalScrollback {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_TERMINAL_SCROLLBACK;
  const snapped =
    Math.round(num / TERMINAL_SCROLLBACK_STEP) * TERMINAL_SCROLLBACK_STEP;
  return Math.min(TERMINAL_SCROLLBACK_MAX, Math.max(TERMINAL_SCROLLBACK_MIN, snapped));
}

export type FontFamily = string;
export const DEFAULT_UI_FONT: FontFamily =
  '"SF Pro Display", "IBM Plex Sans", "PingFang SC", "Noto Sans SC", sans-serif';

const MONO_FONT_WINDOWS: FontFamily = "Consolas";
const MONO_FONT_WINDOWS_STACK: FontFamily =
  'Consolas, "Cascadia Mono", "JetBrains Mono", "Fira Code", monospace';
const MONO_FONT_MAC: FontFamily =
  '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, ui-monospace, monospace';
const MONO_FONT_LINUX: FontFamily =
  '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", "Liberation Mono", ui-monospace, monospace';
const MONO_FONT_FALLBACK: FontFamily =
  '"JetBrains Mono", "Fira Code", ui-monospace, monospace';
const MONO_FONT_PR326_INITIAL_FALLBACK: FontFamily =
  '"JetBrains Mono", "Fira Code", "Cascadia Mono", Consolas, "SF Mono", Menlo, ui-monospace, monospace';

export function getDefaultMonoFont(): FontFamily {
  if (typeof navigator === "undefined") return MONO_FONT_FALLBACK;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return MONO_FONT_WINDOWS;
  if (/Mac OS X|Macintosh/i.test(ua)) return MONO_FONT_MAC;
  if (/Linux/i.test(ua)) return MONO_FONT_LINUX;
  return MONO_FONT_FALLBACK;
}

// 老版本 App.tsx 的 useEffect 无差别把当时的默认 mono 字体也写进 localStorage,
// 导致后续改默认对老用户失效。所有"曾经作为自动默认值出现过"的字符串都视为
// "用户未自定义",在 getInitialFontFamily 里清掉后回退到当前平台默认。
const LEGACY_AUTO_MONO_FONTS: ReadonlySet<string> = new Set([
  MONO_FONT_FALLBACK,
  MONO_FONT_WINDOWS,
  MONO_FONT_WINDOWS_STACK,
  MONO_FONT_MAC,
  MONO_FONT_LINUX,
  MONO_FONT_PR326_INITIAL_FALLBACK,
]);

export function isAutoDefaultMonoFont(value: string): boolean {
  return LEGACY_AUTO_MONO_FONTS.has(value.trim());
}

export type TaskStatus =
  | "todo"
  | "pending"
  | "running"
  | "input_required"
  | "awaiting_review"
  | "detached"
  | "interrupted"
  | "done"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  projectId: string;
  name?: string;
  prompt: string;
  agent: AgentType;
  permissionMode: PermissionMode;
  /** 缺省时沿用 agent 自身默认模型。保存任务快照，避免设置目录变化影响 resume/fork。 */
  model?: string;
  /** 缺省时沿用 agent 自身默认思考深度。 */
  reasoningEffort?: string;
  status: TaskStatus;
  createdAt: number;
  /** 任务状态最近一次变更的时间戳；左侧任务列表按此字段排序与分组。缺省时回落到 createdAt。 */
  updatedAt?: number;
  attentionRequestedAt?: number;
  starred?: boolean;
  failureReason?: string;
  codexSessionId?: string;
  codexSessionPath?: string;
  claudeSessionId?: string;
  claudeSessionPath?: string;
}

export const PERM_LABELS: Record<PermissionMode, string> = {
  ask: "Ask Permission",
  auto_edit: "Auto-edit",
  full_access: "Full Access",
};

/** 权限目录条目（coding_get_permission_catalog）：适配层按 CLI 版本解析出的
 * 实际下发参数与副标题 key（docs/situations/260816-agent-cli-compat.md） */
export interface PermTierCatalogItem {
  key: PermissionMode;
  args: string[];
  subtitleKey: string;
  degraded: boolean;
}

export interface PermAgentCatalog {
  agent: AgentType;
  version: string;
  tiers: PermTierCatalogItem[];
  effortStyle: string;
  trustedProject: boolean;
}

export function permissionModeLabel(
  mode: PermissionMode,
  agent?: AgentType,
  askLabel = PERM_LABELS.ask,
): string {
  if (agent === "codex" && mode === "auto_edit") {
    return "Auto Mode";
  }
  if (mode === "ask") return askLabel;
  return PERM_LABELS[mode];
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Todo",
  pending: "Pending",
  running: "Running...",
  input_required: "Needs confirmation",
  awaiting_review: "Awaiting review",
  detached: "Terminal disconnected",
  interrupted: "Interrupted",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return (
    status === "pending" ||
    status === "running" ||
    status === "input_required" ||
    status === "awaiting_review" ||
    status === "detached"
  );
}

// ── Notifications ────────────────────────────────────────────────────────────
// （notification / usage / skill-hub 功能已按 260815 决议拆除）

