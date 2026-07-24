import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommandBlock from "./CommandBlock";
import { useLayoutStore } from "../stores/layoutStore";
import { useTerminalStore } from "../stores/terminalStore";
import type { ToolCall } from "../types";

vi.mock("../api/chat", () => ({
  confirmDecision: vi.fn().mockResolvedValue(true),
  createSession: vi.fn(),
  queryAgents: vi.fn().mockResolvedValue([]),
  streamChat: vi.fn(() => () => {}),
}));
vi.mock("../api/terminal", () => ({
  sendTerminalCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../terminal/terminalManager", () => ({
  getTerminalSessionId: vi.fn(() => "ts-1"),
  focusTerminal: vi.fn(),
  getRecentOutput: vi.fn(() => null),
}));

import { confirmDecision } from "../api/chat";
import { sendTerminalCommand } from "../api/terminal";

const pendingCall: ToolCall = {
  toolCallId: "t1",
  toolName: "executeCommand",
  command: "systemctl restart nginx",
  status: "pending_confirm",
  confirmId: "c1",
};

beforeEach(() => {
  vi.clearAllMocks();
  useTerminalStore.setState({ tabs: [], activeId: "conn-1" });
  useLayoutStore.setState({
    showSidebar: true,
    showTerminal: false,
    activeSidebarView: "servers",
    centerView: "sftp",
    attentionPulse: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("写命令确认门交互", () => {
  it("允许执行：唤醒后端 ConfirmGate 且注意力跟随命令切到终端", () => {
    render(<CommandBlock call={pendingCall} />);

    fireEvent.click(screen.getByRole("button", { name: "允许执行" }));

    expect(confirmDecision).toHaveBeenCalledWith("c1", true);
    expect(useLayoutStore.getState()).toMatchObject({
      showTerminal: true,
      centerView: "terminal",
    });
  });

  it("拒绝：播完熄火动效（220ms）后才通知后端，且不切终端", () => {
    vi.useFakeTimers();
    render(<CommandBlock call={pendingCall} />);

    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(confirmDecision).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(confirmDecision).toHaveBeenCalledWith("c1", false);
    expect(useLayoutStore.getState().centerView).toBe("sftp");
  });
});

describe("危险命令重执行防呆", () => {
  it("弹应用内确认，「仍要执行」后才发终端命令", () => {
    const dangerCall: ToolCall = {
      toolCallId: "t2",
      toolName: "executeCommand",
      command: "rm -rf / --no-preserve-root",
      status: "success",
    };
    render(<CommandBlock call={dangerCall} />);

    fireEvent.click(screen.getByTitle("在活跃终端执行"));
    expect(sendTerminalCommand).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "仍要执行" }));
    expect(sendTerminalCommand).toHaveBeenCalledWith(
      "ts-1",
      "rm -rf / --no-preserve-root"
    );
  });
});
