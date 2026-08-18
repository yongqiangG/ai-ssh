import { beforeEach, describe, expect, it } from "vitest";
import {
  attentionTaskTitle,
  isAttentionStatus,
  shouldShowAttentionBanner,
  useAttentionStore,
  type AttentionBannerVisibilityInput,
} from "../attention";

function input(overrides: Partial<AttentionBannerVisibilityInput> = {}): AttentionBannerVisibilityInput {
  return {
    status: "input_required",
    taskId: "task-b",
    enabled: true,
    windowFocused: true,
    panelActive: false,
    activeProjectId: null,
    selectedTaskId: null,
    isNewTask: true,
    kanbanOpen: false,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useAttentionStore.setState({
    banners: [],
    pendingCount: 0,
    pendingBumpedAt: 0,
    // 默认开（localStorage 空 → true）
    attentionBadgeEnabled: true,
  });
});

describe("shouldShowAttentionBanner 终端级可见性判定", () => {
  it("SSH 视图（面板非激活）：任何待确认任务都不可见 → 弹", () => {
    expect(shouldShowAttentionBanner(input({ panelActive: false }))).toBe(true);
  });

  it("非待确认状态 / 开关关 / 失焦 → 不弹（失焦归 Rust OS toast 管）", () => {
    expect(shouldShowAttentionBanner(input({ status: "running" }))).toBe(false);
    expect(shouldShowAttentionBanner(input({ status: "done" }))).toBe(false);
    expect(shouldShowAttentionBanner(input({ enabled: false }))).toBe(false);
    expect(shouldShowAttentionBanner(input({ windowFocused: false }))).toBe(false);
  });

  it("面板激活 + 项目列表页（无激活项目）→ 不弹，只靠角标", () => {
    expect(
      shouldShowAttentionBanner(input({ panelActive: true, activeProjectId: null })),
    ).toBe(false);
  });

  it("面板激活 + 看板浮层打开 → 不弹", () => {
    expect(
      shouldShowAttentionBanner(
        input({ panelActive: true, activeProjectId: "p1", kanbanOpen: true }),
      ),
    ).toBe(false);
  });

  it("盯着任务 A 终端时任务 A 待确认 → 不弹（现场就在眼前）", () => {
    expect(
      shouldShowAttentionBanner(
        input({
          panelActive: true,
          activeProjectId: "p1",
          selectedTaskId: "task-b",
          isNewTask: false,
        }),
      ),
    ).toBe(false);
  });

  it("盯着任务 A 终端时任务 B 待确认（同项目跨任务）→ 弹", () => {
    expect(
      shouldShowAttentionBanner(
        input({
          panelActive: true,
          activeProjectId: "p1",
          selectedTaskId: "task-a",
          isNewTask: false,
        }),
      ),
    ).toBe(true);
  });

  it("跨项目隐藏层任务待确认 → 弹", () => {
    expect(
      shouldShowAttentionBanner(
        input({
          panelActive: true,
          activeProjectId: "p1",
          selectedTaskId: "task-a",
          isNewTask: false,
          taskId: "task-other-project",
        }),
      ),
    ).toBe(true);
  });

  it("项目页停在新任务表单（isNewTask，无终端可见）→ 弹", () => {
    expect(
      shouldShowAttentionBanner(input({ panelActive: true, activeProjectId: "p1", isNewTask: true })),
    ).toBe(true);
  });
});

describe("attention store", () => {
  it("push 新横幅排最前；同任务重推替换旧条目并递增 seq", () => {
    const s = useAttentionStore.getState();
    s.pushAttentionBanner({
      taskId: "t1",
      status: "input_required",
      title: "A",
      projectName: "P",
      agentName: "Claude",
    });
    s.pushAttentionBanner({
      taskId: "t2",
      status: "awaiting_review",
      title: "B",
      projectName: "P",
      agentName: "Codex",
    });
    s.pushAttentionBanner({
      taskId: "t1",
      status: "awaiting_review",
      title: "A2",
      projectName: "P",
      agentName: "Claude",
    });

    const banners = useAttentionStore.getState().banners;
    expect(banners.map((b) => b.taskId)).toEqual(["t1", "t2"]);
    expect(banners[0].title).toBe("A2");
    expect(banners[0].seq).toBeGreaterThan(banners[1].seq);
  });

  it("expire 只杀 seq 匹配的那一代：过期回调不误杀重弹的新横幅", () => {
    const s = useAttentionStore.getState();
    s.pushAttentionBanner({
      taskId: "t1",
      status: "input_required",
      title: "old",
      projectName: "P",
      agentName: "Claude",
    });
    const firstSeq = useAttentionStore.getState().banners[0].seq;

    // 同任务重触发 → 新一代
    s.pushAttentionBanner({
      taskId: "t1",
      status: "input_required",
      title: "new",
      projectName: "P",
      agentName: "Claude",
    });

    // 旧一代的过期回调到达：不应移除新一代
    s.expireAttentionBanner("t1", firstSeq);
    expect(useAttentionStore.getState().banners).toHaveLength(1);
    expect(useAttentionStore.getState().banners[0].title).toBe("new");

    // 新一代自己的过期回调：移除
    s.expireAttentionBanner("t1", useAttentionStore.getState().banners[0].seq);
    expect(useAttentionStore.getState().banners).toHaveLength(0);
  });

  it("dismiss 无条件移除（用户手动关闭）", () => {
    const s = useAttentionStore.getState();
    s.pushAttentionBanner({
      taskId: "t1",
      status: "input_required",
      title: "A",
      projectName: "P",
      agentName: "Claude",
    });
    useAttentionStore.getState().dismissAttentionBanner("t1");
    expect(useAttentionStore.getState().banners).toHaveLength(0);
  });

  it("setPendingCount 只在增长时更新 pendingBumpedAt（角标脉冲信号）", () => {
    const s = useAttentionStore.getState();
    s.setPendingCount(2);
    const bumpedFirst = useAttentionStore.getState().pendingBumpedAt;
    expect(bumpedFirst).toBeGreaterThan(0);

    // 不增长：计数更新但不脉冲
    s.setPendingCount(1);
    expect(useAttentionStore.getState().pendingCount).toBe(1);
    expect(useAttentionStore.getState().pendingBumpedAt).toBe(bumpedFirst);

    s.setPendingCount(2);
    expect(useAttentionStore.getState().pendingBumpedAt).toBeGreaterThanOrEqual(bumpedFirst);
  });

  it("开关持久化 localStorage（与 AiCodingApp 旧键一致），默认开", () => {
    expect(useAttentionStore.getState().attentionBadgeEnabled).toBe(true);

    useAttentionStore.getState().setAttentionBadgeEnabled(false);
    expect(localStorage.getItem("ai-ssh:aiCoding:attentionBadge")).toBe("0");

    useAttentionStore.getState().setAttentionBadgeEnabled(true);
    expect(localStorage.getItem("ai-ssh:aiCoding:attentionBadge")).toBe("1");
  });
});

describe("isAttentionStatus / attentionTaskTitle", () => {
  it("与 Rust notify.rs 同口径：仅 input_required / awaiting_review", () => {
    expect(isAttentionStatus("input_required")).toBe(true);
    expect(isAttentionStatus("awaiting_review")).toBe(true);
    for (const status of ["pending", "running", "done", "failed", "interrupted", "detached"] as const) {
      expect(isAttentionStatus(status)).toBe(false);
    }
  });

  it("标题规则与 taskTitle 一致：name 优先，否则 prompt 首行，再退 (untitled)", () => {
    expect(attentionTaskTitle({ name: "  命名任务  ", prompt: "x" })).toBe("命名任务");
    expect(attentionTaskTitle({ name: undefined, prompt: "首行\n次行" })).toBe("首行");
    expect(attentionTaskTitle({ name: "  ", prompt: "\n  " })).toBe("(untitled)");
    expect(attentionTaskTitle({ name: undefined, prompt: "" })).toBe("(untitled)");
  });
});
