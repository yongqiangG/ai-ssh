import { create } from "zustand";
import type { Task, TaskStatus } from "./types";

/**
 * 应用内待确认提醒（260818 grill 决议）：横幅 + ActivityBar 角标 + 开关状态。
 *
 * 信号分层：窗口失焦由 Rust OS toast 负责（notify.rs，判定含 !is_focused）；
 * 窗口聚焦但待确认任务「当前不可见」时由本模块的应用内横幅负责——两路
 * 天然互斥，Rust 判定零依赖视图状态。可见性粒度 = 终端级：待确认任务
 * 所属终端 ≠ 当前可见终端才弹；列表页/看板（无激活终端）只靠角标不横幅。
 */

/** 与 Rust notify.rs::is_attention_status、project-rail/activity.ts 的计数同口径。 */
export function isAttentionStatus(
  status: TaskStatus,
): status is "input_required" | "awaiting_review" {
  return status === "input_required" || status === "awaiting_review";
}

/** 与 Rust notify.rs::task_display_title / KanbanView::taskTitle 同规则。 */
export function attentionTaskTitle(task: Pick<Task, "name" | "prompt">): string {
  const name = task.name?.trim();
  if (name) return name;
  const firstLine = task.prompt.trim().split("\n")[0]?.trim();
  return firstLine || "(untitled)";
}

// localStorage key 与 AiCodingApp 旧本地 state 写入的键一致，无缝继承用户设置
const ATTENTION_BADGE_KEY = "ai-ssh:aiCoding:attentionBadge";

function readInitialEnabled(): boolean {
  // 默认开启：待确认角标 + 应用内横幅；关闭后回退为项目栏黄色小圆点
  return localStorage.getItem(ATTENTION_BADGE_KEY) !== "0";
}

export interface AttentionBannerItem {
  taskId: string;
  status: "input_required" | "awaiting_review";
  title: string;
  projectName: string;
  /** "Claude" | "Codex"（展示名） */
  agentName: string;
  /** 同任务重复触发递增：横幅过期回调只杀自己那一代，不误杀重弹的新横幅 */
  seq: number;
}

interface AttentionState {
  /** 活动横幅（新触发的排最前），8s 自动过期、点击/X 移除 */
  banners: AttentionBannerItem[];
  /** 全部项目待确认任务总数（input_required + awaiting_review），ActivityBar 角标数据源 */
  pendingCount: number;
  /** pendingCount 最近一次增长的时刻；角标据此脉冲一次 */
  pendingBumpedAt: number;
  /** 应用内提醒总开关（横幅 + 双角标；Rust OS toast 另有独立开关） */
  attentionBadgeEnabled: boolean;
  pushAttentionBanner: (item: Omit<AttentionBannerItem, "seq">) => void;
  dismissAttentionBanner: (taskId: string) => void;
  /** 横幅 8s 到期调用；仅当 seq 匹配当前条目才移除（过期回调不杀重弹的新一代） */
  expireAttentionBanner: (taskId: string, seq: number) => void;
  setPendingCount: (count: number) => void;
  setAttentionBadgeEnabled: (enabled: boolean) => void;
}

let bannerSeq = 0;

export const useAttentionStore = create<AttentionState>((set) => ({
  banners: [],
  pendingCount: 0,
  pendingBumpedAt: 0,
  attentionBadgeEnabled: readInitialEnabled(),

  pushAttentionBanner: (item) =>
    set((s) => ({
      banners: [
        { ...item, seq: ++bannerSeq },
        // 同任务旧横幅被新一代替换（与 OS toast tag=task_id 替换语义一致）
        ...s.banners.filter((b) => b.taskId !== item.taskId),
      ],
    })),

  dismissAttentionBanner: (taskId) =>
    set((s) => ({ banners: s.banners.filter((b) => b.taskId !== taskId) })),

  expireAttentionBanner: (taskId, seq) =>
    set((s) => ({
      banners: s.banners.filter((b) => !(b.taskId === taskId && b.seq === seq)),
    })),

  setPendingCount: (count) =>
    set((s) =>
      count > s.pendingCount
        ? { pendingCount: count, pendingBumpedAt: Date.now() }
        : { pendingCount: count },
    ),

  setAttentionBadgeEnabled: (enabled) => {
    localStorage.setItem(ATTENTION_BADGE_KEY, enabled ? "1" : "0");
    set({ attentionBadgeEnabled: enabled });
  },
}));

export interface AttentionBannerVisibilityInput {
  status: TaskStatus;
  taskId: string;
  /** 应用内提醒开关 */
  enabled: boolean;
  /** 窗口聚焦；失焦由 Rust OS toast 负责，两路互斥 */
  windowFocused: boolean;
  /** aiCoding 面板激活（centerView === "aiCoding"） */
  panelActive: boolean;
  /** 激活项目 id；null = 项目列表页（WelcomePage） */
  activeProjectId: string | null;
  /** 激活项目视图当前选中任务的终端；isNewTask=true 时页面在新任务表单、无终端可见 */
  selectedTaskId: string | null;
  isNewTask: boolean;
  /** 看板浮层打开（覆盖当前页面，任务列表不在眼前但角标可见） */
  kanbanOpen: boolean;
}

/**
 * 横幅可见性判定（纯函数，终端级粒度）：
 * 非待确认状态 / 开关关 / 失焦 → 不弹；
 * SSH 视图（面板非激活）→ 任何待确认任务都不可见，弹；
 * 面板激活时：看板浮层或列表页任务列表就在眼前 → 只靠角标不弹；
 * 项目页内：待确认任务 ≠ 当前可见终端 → 弹（同项目跨任务 + 跨项目隐藏层都覆盖）。
 */
export function shouldShowAttentionBanner(input: AttentionBannerVisibilityInput): boolean {
  if (!isAttentionStatus(input.status)) return false;
  if (!input.enabled || !input.windowFocused) return false;
  if (!input.panelActive) return true;
  if (input.kanbanOpen || input.activeProjectId == null) return false;
  const visibleTaskId = input.isNewTask ? null : input.selectedTaskId;
  return input.taskId !== visibleTaskId;
}
