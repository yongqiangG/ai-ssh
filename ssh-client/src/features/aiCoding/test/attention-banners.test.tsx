import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionBanners, BANNER_TTL_MS } from "../components/AttentionBanners";
import { useAttentionStore } from "../attention";
import {
  consumePendingCodingNavigation,
  peekPendingCodingNavigation,
} from "../pendingNavigation";
import { I18nProvider } from "../i18n";
import { useLayoutStore } from "../../../stores/layoutStore";

// I18nProvider 挂载时会 invoke 同步语言到 Rust——mock 掉（jsdom 无 tauri）
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.reject(new Error("no tauri")),
  convertFileSrc: (p: string) => p,
  Channel: class {},
}));

function renderBanners(ttlMs = 30) {
  return render(
    <I18nProvider>
      <AttentionBanners ttlMs={ttlMs} />
    </I18nProvider>,
  );
}

function pushBanner(taskId: string, title = taskId) {
  // act 包裹：store 更新驱动的重渲染同步提交，断言前已可见
  act(() => {
    useAttentionStore.getState().pushAttentionBanner({
      taskId,
      status: "input_required",
      title,
      projectName: "demo-proj",
      agentName: "Claude",
    });
  });
}

beforeEach(() => {
  localStorage.clear();
  useAttentionStore.setState({
    banners: [],
    pendingCount: 0,
    pendingBumpedAt: 0,
    attentionBadgeEnabled: true,
  });
  useLayoutStore.setState({ centerView: "sftp" });
  // pendingNavigation 是模块级单例，用例间必须清桥
  consumePendingCodingNavigation();
});

describe("AttentionBanners 应用内横幅", () => {
  it("无横幅时不渲染任何节点", () => {
    const { container } = renderBanners();
    expect(container.firstChild).toBeNull();
  });

  it("推送横幅后渲染卡片：标题 + 项目·agent 元信息", () => {
    renderBanners();
    pushBanner("task-1", "修复登录超时");

    expect(screen.getByText("修复登录超时")).toBeTruthy();
    expect(screen.getByText("demo-proj · Claude")).toBeTruthy();
  });

  it("点击卡片：清横幅 + 切 aiCoding 视图 + 写 pendingNavigation 桥", () => {
    renderBanners();
    pushBanner("task-1", "任务一");

    fireEvent.click(screen.getByRole("button", { name: /任务一/ }));

    expect(useAttentionStore.getState().banners).toHaveLength(0);
    expect(useLayoutStore.getState().centerView).toBe("aiCoding");
    expect(peekPendingCodingNavigation()?.taskId).toBe("task-1");
  });

  it("X 按钮只关横幅，不触发跳转", () => {
    renderBanners();
    pushBanner("task-1", "任务一");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss banner" }));

    expect(useAttentionStore.getState().banners).toHaveLength(0);
    expect(useLayoutStore.getState().centerView).toBe("sftp");
    expect(peekPendingCodingNavigation()).toBeNull();
  });

  it("ttl 到期自动收走", async () => {
    renderBanners(30);
    pushBanner("task-1", "会消失的任务");

    expect(screen.getByText("会消失的任务")).toBeTruthy();
    await waitFor(
      () => {
        expect(useAttentionStore.getState().banners).toHaveLength(0);
      },
      { timeout: 1000 },
    );
  });

  it("堆叠封顶 3 条 + 溢出行（第 4 条起折叠为计数）", async () => {
    renderBanners(BANNER_TTL_MS);
    for (let i = 1; i <= 5; i++) pushBanner(`task-${i}`, `任务${i}`);

    // AnimatePresence exit 动画在 jsdom 真实计时器下需数百 ms 收敛，
    // 等被挤出画面的两张卡完成退出后再数当前可见卡
    await waitFor(
      () => {
        const cards = screen.getAllByRole("button", {
          name: /跳转到任务终端|jump to task terminal/,
        });
        expect(cards).toHaveLength(3);
      },
      { timeout: 3000 },
    );
    // jsdom 默认 en：+2 more pending
    expect(screen.getByText("+2 more pending")).toBeTruthy();
  });
});
