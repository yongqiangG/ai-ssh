import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import ChatPanel from "./ChatPanel";
import { useChatStore } from "../stores/chatStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useTerminalStore } from "../stores/terminalStore";

beforeEach(() => {
  localStorage.clear();
  // jsdom 未实现 scrollIntoView，带消息渲染时 ChatPanel 的保持到底逻辑会触发
  Element.prototype.scrollIntoView = () => {};
  useChatStore.setState({
    conversations: [],
    currentId: null,
    agentId: "general",
    sending: false,
    agents: [{ id: "general", name: "General" }],
    agentsError: null,
    cmdHistory: [],
    thinkingEnabled: false,
    attachContext: false,
    quote: null,
  });
  useTerminalStore.setState({ tabs: [], activeId: null });
  useLayoutStore.setState({
    showSidebar: false,
    showTerminal: false,
    activeSidebarView: "files",
    centerView: "sftp",
    attentionPulse: null,
  });
});

describe("ChatPanel terminal hint", () => {
  it("点击未连接提示会展开连接面板、切回终端工作区并触发注意力脉冲", () => {
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole("button", { name: /点击此处连接服务器/ }));

    expect(useLayoutStore.getState()).toMatchObject({
      showSidebar: true,
      showTerminal: true,
      activeSidebarView: "servers",
      centerView: "terminal",
      attentionPulse: "servers",
    });
  });

  it("面板已全部展开时点击仍触发注意力脉冲（幂等写入外的唯一反馈）", () => {
    useLayoutStore.setState({
      showSidebar: true,
      showTerminal: true,
      activeSidebarView: "servers",
      centerView: "terminal",
    });
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole("button", { name: /点击此处连接服务器/ }));

    expect(useLayoutStore.getState().attentionPulse).toBe("servers");
  });
});

describe("流式期间空占位隐藏的边界（confirm 假死回归）", () => {
  const baseConv = (messages: unknown[]) => ({
    conversations: [
      {
        id: "conv",
        title: "对话",
        agentId: "general",
        contextStatus: "active" as const,
        messages,
        createdAt: 1,
      },
    ],
    currentId: "conv",
    sending: true,
  });

  it("sending 中无 content 但带待确认命令块的消息必须可见可点", () => {
    useChatStore.setState(
      baseConv([
        { id: "u1", role: "user", content: "重启 nginx", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: "",
          timestamp: 2,
          toolCalls: [
            {
              toolCallId: "t1",
              toolName: "executeCommand",
              command: "systemctl restart nginx",
              status: "pending_confirm",
              confirmId: "c1",
            },
          ],
        },
      ]) as never
    );
    render(<ChatPanel />);

    expect(screen.getByRole("button", { name: "允许执行" })).toBeTruthy();
  });

  it("sending 中真正的空占位仍隐藏（双头像保护不回退）", () => {
    useChatStore.setState(
      baseConv([
        { id: "u1", role: "user", content: "你好", timestamp: 1 },
        { id: "a1", role: "assistant", content: "", timestamp: 2 },
      ]) as never
    );
    render(<ChatPanel />);

    // 空占位隐藏后，最后可见消息是 user → 只有 typing，无 assistant 气泡
    expect(screen.queryByRole("button", { name: "允许执行" })).toBeNull();
  });
});

describe("ChatPanel history footer", () => {
  it("历史会话隐藏输入框、展示只读提示并可一键新建对话", () => {
    useChatStore.setState({
      conversations: [
        {
          id: "history",
          title: "历史",
          agentId: "general",
          contextStatus: "history",
          historyReason: "app_restarted",
          messages: [{ id: "m1", role: "user", content: "旧问题", timestamp: 1 }],
          createdAt: 1,
        },
      ],
      currentId: "history",
    });
    render(<ChatPanel />);

    expect(screen.getByText("历史会话暂不支持继续对话")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

    const state = useChatStore.getState();
    const current = state.conversations.find((c) => c.id === state.currentId)!;
    expect(current.contextStatus).toBe("active");
    expect(current.messages).toHaveLength(0);
    expect(state.conversations.some((c) => c.id === "history")).toBe(true);
  });
});
