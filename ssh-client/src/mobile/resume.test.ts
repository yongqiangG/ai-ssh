import { describe, expect, it } from "vitest";
import type { Task } from "./api";
import { isTaskResumable, resumeSessionId } from "./resume";

function task(over: Partial<Task>): Task {
  return {
    id: "t1",
    projectId: "p1",
    name: null,
    prompt: "hi",
    agent: "claude",
    permissionMode: "ask",
    status: "done",
    createdAt: 1,
    claudeSessionId: "sess-c",
    ...over,
  };
}

describe("isTaskResumable / resumeSessionId", () => {
  it("四个可恢复状态 + 有 sessionId → 可恢复", () => {
    for (const status of ["done", "failed", "cancelled", "interrupted"]) {
      expect(isTaskResumable(task({ status })), status).toBe(true);
    }
  });

  it("active 与 detached 状态不可恢复（detached 一期不开放）", () => {
    for (const status of [
      "pending",
      "running",
      "input_required",
      "awaiting_review",
      "detached",
    ]) {
      expect(isTaskResumable(task({ status })), status).toBe(false);
    }
  });

  it("无 sessionId 不可恢复（与桌面 resumeUnavailable 同语义）", () => {
    expect(isTaskResumable(task({ claudeSessionId: null }))).toBe(false);
    expect(isTaskResumable(task({ claudeSessionId: undefined }))).toBe(false);
  });

  it("sessionId 按 agent 取对应字段", () => {
    expect(resumeSessionId(task({}))).toBe("sess-c");
    expect(
      resumeSessionId(
        task({ agent: "codex", claudeSessionId: null, codexSessionId: "sess-x" }),
      ),
    ).toBe("sess-x");
    expect(resumeSessionId(task({ agent: "codex", claudeSessionId: "sess-c" }))).toBeNull();
  });

  it("显式 status 优先（用实时 WS 状态而非可能滞后的 REST 数据）", () => {
    // REST 拿到 done，但 WS 状态帧已推 running（桌面刚恢复过）→ 不可恢复
    expect(isTaskResumable(task({ status: "done" }), "running")).toBe(false);
    // REST 拿到 running，任务刚结束 → 可恢复
    expect(isTaskResumable(task({ status: "running" }), "done")).toBe(true);
  });
});
