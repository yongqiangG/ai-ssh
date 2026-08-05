import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { useLocalSessionStore } from "./localSessionStore";

beforeEach(() => {
  useLocalSessionStore.setState({ sessions: [], activeTaskId: null });
});

describe("localSessionStore", () => {
  it("keeps the launch options with a running task", () => {
    const task = useLocalSessionStore.getState().startTask({
      projectPath: "C:\\work\\app",
      agent: "codex",
      prompt: "fix the tests",
      permissionMode: "auto_edit",
      fileRefs: ["src/main.ts"],
      images: ["data:image/png;base64,AA=="],
      texts: ["context"],
    });

    expect(task).toMatchObject({
      agent: "codex",
      permissionMode: "auto_edit",
      operation: "run",
      fileRefs: ["src/main.ts"],
      images: ["data:image/png;base64,AA=="],
      texts: ["context"],
    });
    expect(useLocalSessionStore.getState().activeTaskId).toBe(task.taskId);
  });

  it("updates a task from snake_case backend events after normalization", () => {
    const task = useLocalSessionStore.getState().startTask({
      projectPath: "C:\\work\\app",
      agent: "claude",
      prompt: "inspect",
    });

    useLocalSessionStore.getState().updateStatus({
      taskId: task.taskId,
      status: "done",
    });
    useLocalSessionStore.getState().attachSession({
      taskId: task.taskId,
      agent: "claude",
      sessionId: "session-1",
      sessionPath: "C:\\sessions\\one.jsonl",
    });

    expect(useLocalSessionStore.getState().sessions[0]).toMatchObject({
      status: "done",
      sessionId: "session-1",
      sessionPath: "C:\\sessions\\one.jsonl",
    });
  });
});
