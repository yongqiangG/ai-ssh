import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { useLocalSessionStore } from "./localSessionStore";
import LocalSidebar from "./LocalSidebar";
import { useProjectStore } from "../stores/projectStore";

beforeEach(() => {
  useProjectStore.setState({
    projects: [
      {
        id: "c:\\work\\app",
        path: "C:\\work\\app",
        name: "app",
        lastUsedAt: 1,
      },
    ],
    activeProjectPath: "C:\\work\\app",
  });
  useLocalSessionStore.setState({ sessions: [], activeTaskId: null });
});

describe("LocalSidebar", () => {
  it("renders the local project sidebar without an unstable selector snapshot", () => {
    render(<LocalSidebar />);

    expect(screen.getByText("本地项目")).toBeInTheDocument();
    expect(
      screen.getByText("选择项目后，新建本地 agent 任务"),
    ).toBeInTheDocument();
  });
});
