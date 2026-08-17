import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiCodingPanel from "../AiCodingPanel";

// tauri invoke 在 jsdom 里不存在：mock 为 reject，模拟「后端命令全部失败」
// 的最差场景——首屏仍应渲染出 WelcomePage 而不是空白/异常。
const invokeMock = vi.fn((..._args: unknown[]) =>
  Promise.reject(new Error("no tauri")),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
  Channel: class {},
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
  invokeMock.mockClear();
});

describe("AiCodingPanel 首屏", () => {
  it("后端命令全部失败时仍渲染 WelcomePage（非空白）", async () => {
    const { container } = render(<AiCodingPanel active={true} />);

    // body 作用域类已挂上（设计令牌生效的前提；保活后面板常驻，类跟随 active）
    expect(document.body.classList.contains("ai-coding-active")).toBe(true);

    // WelcomePage 有可交互内容：新建项目入口
    await waitFor(
      () => {
        expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    // WelcomePage 有可交互按钮（语言无关：jsdom 默认 en，真机 zh）
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  });
});
