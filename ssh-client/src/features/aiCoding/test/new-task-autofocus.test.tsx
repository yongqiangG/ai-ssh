import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewTaskView, type NewTaskDraft } from "../components/NewTaskView";
import { I18nProvider } from "../i18n";
import type { Project } from "../types";

// tauri invoke 在 jsdom 里不存在：mock 为 reject，模拟「后端命令全部失败」
// 的最差场景——mount 后仍应完成自动聚焦（focus 不依赖任何后端结果）。
const invokeMock = vi.fn((..._args: unknown[]) =>
  Promise.reject(new Error("no tauri")),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
  Channel: class {},
}));

const project: Project = {
  id: "p1",
  name: "demo",
  path: "D:/proj/demo",
  lastOpenedAt: 0,
};

function renderNewTask(initialDraft?: NewTaskDraft | null) {
  return render(
    <I18nProvider>
      <NewTaskView
        project={project}
        onSubmit={vi.fn()}
        initialDraft={initialDraft}
        onCacheDraft={vi.fn()}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  invokeMock.mockClear();
});

describe("新建任务自动聚焦", () => {
  it("mount 后焦点落在提示词编辑器上（无需二次点击）", async () => {
    renderNewTask();

    const editor = await waitFor(() => {
      const el = document.querySelector('div[role="textbox"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(document.activeElement).toBe(editor);
  });

  it("恢复草稿时 caret 落在文本末尾（可直接续打）", async () => {
    const draft: NewTaskDraft = {
      promptHtml: "hello draft",
      agent: "claude",
      permMode: "ask",
      planMode: false,
      pastedImages: [],
      pastedTexts: [],
    };
    renderNewTask(draft);

    const editor = await waitFor(() => {
      const el = document.querySelector('div[role="textbox"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 聚焦 + caret 在末尾：selection 折叠于编辑器，collapse(false) 后落点在
    // 最后一个子节点之后。空文本时 focusOffset=0（开头）；有子节点时为子节点
    // 数（即"末尾之后"），不细究具体文本偏移——跨浏览器实现相关，锁定"在
    // 编辑器内且不是开头"即可。
    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    expect(sel!.focusNode).toBe(editor);
    expect(sel!.isCollapsed).toBe(true);
    expect(sel!.focusOffset).toBe(editor.childNodes.length);
    expect(editor.textContent!.length).toBeGreaterThan(0);
  });
});
