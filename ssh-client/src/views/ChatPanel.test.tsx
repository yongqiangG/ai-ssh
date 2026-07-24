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
