import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import ActivityBar from "./ActivityBar";
import { useLayoutStore } from "../stores/layoutStore";
import { useAttentionStore } from "../features/aiCoding/attention";

beforeEach(() => {
  localStorage.clear();
  useLayoutStore.setState({
    leftWidth: 280,
    rightWidth: 380,
    showSidebar: true,
    showTerminal: true,
    showAiPanel: true,
    activeSidebarView: "servers",
    centerView: "terminal",
    attentionPulse: null,
  });
  useAttentionStore.setState({
    banners: [],
    pendingCount: 0,
    pendingBumpedAt: 0,
    attentionBadgeEnabled: true,
  });
});

describe("ActivityBar AI Coding 入口", () => {
  it("点击 AI Coding 按钮切换到整窗接管视图，且不改动侧栏状态", () => {
    render(<ActivityBar />);

    fireEvent.click(screen.getByRole("button", { name: "AI Coding" }));

    expect(useLayoutStore.getState().centerView).toBe("aiCoding");
    // 整窗接管不动侧栏状态，切回 SSH 视图时布局原样恢复
    expect(useLayoutStore.getState().showSidebar).toBe(true);
    expect(useLayoutStore.getState().activeSidebarView).toBe("servers");
  });

  it("aiCoding 视图下点击终端按钮切回终端工作区", () => {
    useLayoutStore.setState({ centerView: "aiCoding", showSidebar: false });
    render(<ActivityBar />);

    fireEvent.click(screen.getByRole("button", { name: "终端" }));

    expect(useLayoutStore.getState().centerView).toBe("terminal");
    // SSH 侧栏按钮自带「折叠时自动展开」
    expect(useLayoutStore.getState().showSidebar).toBe(true);
  });

  it("AI Coding 按钮在 aiCoding 视图时呈激活态", () => {
    useLayoutStore.setState({ centerView: "aiCoding" });
    render(<ActivityBar />);

    expect(
      screen.getByRole("button", { name: "AI Coding" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "终端" }).getAttribute("aria-pressed")
    ).toBe("false");
  });
});

describe("ActivityBar AI Coding 待确认角标（260818）", () => {
  it("有待确认任务且开关开 → 显示计数角标", () => {
    act(() => {
      useAttentionStore.setState({ pendingCount: 3, pendingBumpedAt: 1 });
    });
    render(<ActivityBar />);

    const codingBtn = screen.getByRole("button", { name: "AI Coding" });
    expect(codingBtn.textContent).toContain("3");
  });

  it("开关关或计数为零 → 不显示角标；计数回升恢复显示", () => {
    act(() => {
      useAttentionStore.setState({ pendingCount: 3, attentionBadgeEnabled: false });
    });
    render(<ActivityBar />);
    expect(screen.getByRole("button", { name: "AI Coding" }).textContent).not.toContain("3");

    // 同一渲染实例内切换：计数归零
    act(() => {
      useAttentionStore.setState({ pendingCount: 0, attentionBadgeEnabled: true });
    });
    expect(screen.getByRole("button", { name: "AI Coding" }).textContent).not.toMatch(/\d/);

    // 计数回升（新待确认到达）
    act(() => {
      useAttentionStore.setState({ pendingCount: 2, pendingBumpedAt: 5 });
    });
    expect(screen.getByRole("button", { name: "AI Coding" }).textContent).toContain("2");
  });
});
