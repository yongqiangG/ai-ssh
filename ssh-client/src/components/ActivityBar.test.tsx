import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import ActivityBar from "./ActivityBar";
import { useLayoutStore } from "../stores/layoutStore";

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
