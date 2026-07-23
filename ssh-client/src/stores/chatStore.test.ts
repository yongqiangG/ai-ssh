import { beforeEach, describe, expect, it, vi } from "vitest";

// mock api/chat：单元测试不依赖真实后端；streamChat 同步触发回调以模拟流式
vi.mock("../api/chat", () => ({
  queryAgents: vi.fn(async () => [
    { id: "general", name: "通用助手" },
    { id: "ops", name: "运维专家" },
  ]),
  createSession: vi.fn(async () => ({ sessionId: "test-session" })),
  streamChat: vi.fn((opts: {
    agentId: string;
    onText: (t: string) => void;
    onDone: (t: string) => void;
  }) => {
    const reply =
      opts.agentId === "ops"
        ? "【运维专家】关于该问题，建议按顺序排查。"
        : "【通用助手】你好，我是通用助手。";
    opts.onText(reply);
    opts.onDone(reply);
    return () => {};
  }),
}));

import { useChatStore } from "./chatStore";
import { queryAgents, streamChat } from "../api/chat";

beforeEach(() => {
  localStorage.clear();
  useChatStore.setState({
    conversations: [],
    currentId: null,
    agentId: "general",
    sending: false,
    agents: [],
    agentsError: null,
    thinkingEnabled: false,
    errorDetectEnabled: false,
  });
});

describe("chatStore.loadAgents", () => {
  it("总是重新拉取（不因已有 agents 而跳过），并保留仍存在的选中项", async () => {
    useChatStore.setState({
      agents: [{ id: "ops", name: "运维专家", description: "" }],
      agentId: "ops",
    });
    await useChatStore.getState().loadAgents();
    const s = useChatStore.getState();
    expect(vi.mocked(queryAgents)).toHaveBeenCalled();
    expect(s.agents.map((a) => a.id)).toEqual(["general", "ops"]);
    expect(s.agentId).toBe("ops"); // 原选中仍存在 → 保留
    expect(s.agentsError).toBeNull();
  });

  it("选中项不存在于新列表时回落到首个；失败时写入 agentsError", async () => {
    useChatStore.setState({ agentId: "gone" });
    await useChatStore.getState().loadAgents();
    expect(useChatStore.getState().agentId).toBe("general");

    vi.mocked(queryAgents).mockRejectedValueOnce(new Error("backend not ready"));
    await useChatStore.getState().loadAgents();
    expect(useChatStore.getState().agentsError).toBe("backend not ready");
  });
});

describe("chatStore", () => {
  it("newConversation 创建空会话并切换为当前", () => {
    useChatStore.getState().newConversation();
    const s = useChatStore.getState();
    expect(s.conversations).toHaveLength(1);
    expect(s.conversations[0].messages).toHaveLength(0);
    expect(s.currentId).toBe(s.conversations[0].id);
  });

  it("sendMessage 自动建会话并产生用户+AI 两条消息", async () => {
    await useChatStore.getState().sendMessage("你好");
    const conv = useChatStore.getState().conversations[0];
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].content).toBe("你好");
    expect(conv.messages[1].role).toBe("assistant");
    expect(conv.messages[1].content).toContain("通用助手");
  });

  it("首条消息后会用消息内容更新标题", async () => {
    await useChatStore.getState().sendMessage("如何排查磁盘满了的问题");
    const conv = useChatStore.getState().conversations[0];
    expect(conv.title).toBe("如何排查磁盘满了的问题");
  });

  it("sendMessage 在已有会话内追加消息", async () => {
    useChatStore.getState().newConversation();
    const id = useChatStore.getState().currentId!;
    await useChatStore.getState().sendMessage("第一句");
    await useChatStore.getState().sendMessage("第二句");
    const conv = useChatStore.getState().conversations.find((c) => c.id === id)!;
    expect(conv.messages).toHaveLength(4);
  });

  it("setAgent 切换智能体并影响回复", async () => {
    useChatStore.getState().setAgent("ops");
    await useChatStore.getState().sendMessage("报错了");
    const conv = useChatStore.getState().conversations[0];
    expect(conv.messages[1].content).toContain("运维专家");
  });

  it("空文本不会被发送", async () => {
    await useChatStore.getState().sendMessage("   ");
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });

  it("deleteConversation 删除并在删除当前项时回退到首个", async () => {
    await useChatStore.getState().sendMessage("a");
    await useChatStore.getState().newConversation();
    await useChatStore.getState().sendMessage("b");
    const [first, second] = useChatStore.getState().conversations;
    useChatStore.getState().selectConversation(second.id);
    useChatStore.getState().deleteConversation(second.id);
    const s = useChatStore.getState();
    expect(s.conversations.find((c) => c.id === second.id)).toBeUndefined();
    expect(s.currentId).toBe(first.id);
  });

  it("持久化会话到 localStorage", async () => {
    await useChatStore.getState().sendMessage("持久化测试");
    const raw = localStorage.getItem("ai-ssh:chat");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.conversations).toHaveLength(1);
  });
});

describe("深度思考开关（会话内粘滞）", () => {
  it("开启后发送消息不再自动回落，仍保持开启", async () => {
    useChatStore.setState({ thinkingEnabled: true });
    await useChatStore.getState().sendMessage("复杂问题");
    expect(useChatStore.getState().thinkingEnabled).toBe(true);
  });

  it("开启状态随请求发出（streamChat 收到 thinkingEnabled=true）", async () => {
    useChatStore.setState({ thinkingEnabled: true });
    await useChatStore.getState().sendMessage("复杂问题");
    expect(vi.mocked(streamChat)).toHaveBeenLastCalledWith(
      expect.objectContaining({ thinkingEnabled: true })
    );
  });
});

describe("报错自动检测开关（默认关 + v0 迁移）", () => {
  it("v0 持久化数据里的 errorDetectEnabled 被迁移重置为默认关", async () => {
    localStorage.setItem(
      "ai-ssh:chat",
      JSON.stringify({
        state: { conversations: [], cmdHistory: [], errorDetectEnabled: true },
        version: 0,
      })
    );
    await useChatStore.persist.rehydrate();
    expect(useChatStore.getState().errorDetectEnabled).toBe(false);
  });

  it("v1 数据里用户手动开启的值被尊重（迁移只发生一次）", async () => {
    localStorage.setItem(
      "ai-ssh:chat",
      JSON.stringify({
        state: { conversations: [], cmdHistory: [], errorDetectEnabled: true },
        version: 1,
      })
    );
    await useChatStore.persist.rehydrate();
    expect(useChatStore.getState().errorDetectEnabled).toBe(true);
  });
});

describe("写命令确认 fail-safe（confirm_request 与 tool_call 乱序）", () => {
  const orphanStream = (events: (opts: Record<string, (e: unknown) => void>) => void) =>
    vi.mocked(streamChat).mockImplementationOnce((opts: unknown) => {
      const o = opts as Record<string, (e?: unknown) => void>;
      events(o);
      o.onDone?.("");
      return () => {};
    });

  it("confirm_request 先于 tool_call 到达时创建孤儿确认卡（用户始终有地方点）", async () => {
    orphanStream((o) => {
      o.onConfirmRequest?.({
        event: "confirm_request",
        confirmId: "c1",
        toolCallId: "t1",
        toolName: "executeCommand",
        content: "touch /tmp/x",
        analysis: "命令命中写操作规则",
      });
    });
    await useChatStore.getState().sendMessage("创建文件");
    const toolCalls = useChatStore.getState().conversations[0].messages[1].toolCalls ?? [];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].status).toBe("pending_confirm");
    expect(toolCalls[0].confirmId).toBe("c1");
    expect(toolCalls[0].command).toBe("touch /tmp/x");
  });

  it("孤儿卡存在时同 id 的 tool_call 后到不重复建块，确认态保持", async () => {
    orphanStream((o) => {
      o.onConfirmRequest?.({
        event: "confirm_request",
        confirmId: "c1",
        toolCallId: "t1",
        toolName: "executeCommand",
        content: "touch /tmp/x",
      });
      o.onToolCall?.({
        event: "tool_call",
        toolCallId: "t1",
        toolName: "executeCommand",
        content: "touch /tmp/x",
        status: "running",
      });
    });
    await useChatStore.getState().sendMessage("创建文件");
    const toolCalls = useChatStore.getState().conversations[0].messages[1].toolCalls ?? [];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].status).toBe("pending_confirm");
    expect(toolCalls[0].confirmId).toBe("c1");
  });

  it("toolCallId 为空串的乱序场景同样有孤儿卡可点且不重复", async () => {
    orphanStream((o) => {
      o.onConfirmRequest?.({
        event: "confirm_request",
        confirmId: "c2",
        toolCallId: "",
        content: "rm /tmp/y",
      });
      o.onToolCall?.({
        event: "tool_call",
        toolCallId: "",
        toolName: "executeCommand",
        content: "rm /tmp/y",
        status: "running",
      });
    });
    await useChatStore.getState().sendMessage("删除文件");
    const toolCalls = useChatStore.getState().conversations[0].messages[1].toolCalls ?? [];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].status).toBe("pending_confirm");
    expect(toolCalls[0].confirmId).toBe("c2");
  });

  it("正常顺序（tool_call 先到）不回归：单块置为待确认", async () => {
    orphanStream((o) => {
      o.onToolCall?.({
        event: "tool_call",
        toolCallId: "t1",
        toolName: "executeCommand",
        content: "touch /tmp/x",
        status: "running",
      });
      o.onConfirmRequest?.({
        event: "confirm_request",
        confirmId: "c1",
        toolCallId: "t1",
        content: "touch /tmp/x",
      });
    });
    await useChatStore.getState().sendMessage("创建文件");
    const toolCalls = useChatStore.getState().conversations[0].messages[1].toolCalls ?? [];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].status).toBe("pending_confirm");
    expect(toolCalls[0].confirmId).toBe("c1");
  });
});
