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
    sessionNotice: null,
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

  it("归档全部活动对话时保留非空历史、移除空对话并创建新会话", () => {
    useChatStore.setState({
      conversations: [
        {
          id: "active-with-message",
          title: "活动对话",
          agentId: "general",
          contextStatus: "active",
          messages: [{ id: "m1", role: "user", content: "旧问题", timestamp: 1 }],
          createdAt: 1,
          sessionId: "session-1",
        },
        {
          id: "empty",
          title: "新对话",
          agentId: "general",
          contextStatus: "active",
          messages: [],
          createdAt: 2,
        },
      ],
      currentId: "active-with-message",
    });

    useChatStore
      .getState()
      .archiveAllAndStartNew("model_reloaded", "模型配置已更新");

    const state = useChatStore.getState();
    const current = state.conversations.find((c) => c.id === state.currentId)!;
    const history = state.conversations.find((c) => c.id === "active-with-message")!;
    expect(current.contextStatus).toBe("active");
    expect(current.messages).toHaveLength(0);
    expect(history.contextStatus).toBe("history");
    expect(history.historyReason).toBe("model_reloaded");
    expect(history.sessionId).toBeUndefined();
    expect(state.conversations.some((c) => c.id === "empty")).toBe(false);
    expect(state.sessionNotice).toBe("模型配置已更新");
  });

  it("只读历史会话拒绝发送消息", async () => {
    useChatStore.setState({
      conversations: [
        {
          id: "history",
          title: "历史",
          agentId: "general",
          contextStatus: "history",
          messages: [{ id: "m1", role: "user", content: "旧问题", timestamp: 1 }],
          createdAt: 1,
        },
      ],
      currentId: "history",
    });

    const before = vi.mocked(streamChat).mock.calls.length;
    await useChatStore.getState().sendMessage("不应发送");

    expect(vi.mocked(streamChat).mock.calls.length).toBe(before);
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(1);
  });

  it("冷启动把持久化对话作为历史加载并选中新空白会话", async () => {
    localStorage.setItem(
      "ai-ssh:chat",
      JSON.stringify({
        state: {
          conversations: [
            {
              id: "persisted",
              title: "旧对话",
              agentId: "general",
              contextStatus: "active",
              messages: [{ id: "m1", role: "user", content: "旧问题", timestamp: 1 }],
              createdAt: 1,
              sessionId: "must-not-survive",
            },
            {
              id: "persisted-empty",
              title: "新对话",
              agentId: "general",
              contextStatus: "active",
              messages: [],
              createdAt: 2,
            },
          ],
          currentId: "persisted",
          agentId: "general",
          cmdHistory: [],
          errorDetectEnabled: false,
        },
        version: 2,
      })
    );

    await useChatStore.persist.rehydrate();

    const state = useChatStore.getState();
    const current = state.conversations.find((c) => c.id === state.currentId)!;
    const history = state.conversations.find((c) => c.id === "persisted")!;
    expect(current.contextStatus).toBe("active");
    expect(current.messages).toHaveLength(0);
    expect(history.contextStatus).toBe("history");
    expect(history.historyReason).toBe("app_restarted");
    expect(history.sessionId).toBeUndefined();
    expect(state.conversations.some((c) => c.id === "persisted-empty")).toBe(false);
  });
});

describe("深度思考开关（会话内粘滞）", () => {
  it("默认开启（SSH 运维场景偏复杂，答错代价高于等待）", () => {
    expect(useChatStore.getInitialState().thinkingEnabled).toBe(true);
  });

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

describe("归档清理与冷启动横幅", () => {
  it("归档时把 running / pending_confirm 命令块置为 error，历史不携带进行中状态", () => {
    useChatStore.setState({
      conversations: [
        {
          id: "with-zombie",
          title: "带僵尸块",
          agentId: "general",
          contextStatus: "active",
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "",
              timestamp: 1,
              toolCalls: [
                { toolCallId: "t1", toolName: "executeCommand", status: "running" },
                {
                  toolCallId: "t2",
                  toolName: "executeCommand",
                  status: "pending_confirm",
                  confirmId: "c1",
                },
                { toolCallId: "t3", toolName: "executeCommand", status: "success" },
              ],
            },
          ],
          createdAt: 1,
        },
      ],
      currentId: "with-zombie",
    });

    useChatStore.getState().archiveAllAndStartNew("app_restarted", "已重启");

    const history = useChatStore
      .getState()
      .conversations.find((c) => c.id === "with-zombie")!;
    const toolCalls = history.messages[0].toolCalls!;
    expect(toolCalls[0].status).toBe("error");
    expect(toolCalls[0].output).toBe("已随会话归档中断");
    expect(toolCalls[1].status).toBe("error");
    expect(toolCalls[1].confirmId).toBeUndefined();
    expect(toolCalls[2].status).toBe("success");
  });

  it("上次存在活动对话时冷启动弹横幅，全是老历史时安静启动", async () => {
    const conv = (id: string, contextStatus: "active" | "history") => ({
      id,
      title: id,
      agentId: "general",
      contextStatus,
      messages: [{ id: `${id}-m`, role: "user", content: "问", timestamp: 1 }],
      createdAt: 1,
    });
    const persist = (conversations: unknown[]) =>
      localStorage.setItem(
        "ai-ssh:chat",
        JSON.stringify({
          state: {
            conversations,
            currentId: null,
            agentId: "general",
            cmdHistory: [],
            errorDetectEnabled: false,
          },
          version: 2,
        })
      );

    persist([conv("was-active", "active")]);
    await useChatStore.persist.rehydrate();
    expect(useChatStore.getState().sessionNotice).toContain("应用已重新启动");

    persist([conv("old-history", "history")]);
    await useChatStore.persist.rehydrate();
    expect(useChatStore.getState().sessionNotice).toBeNull();
  });
});

describe("调用失败人话提示与手动重试", () => {
  it("onError 写入 errorText/errorCode，半截回复保留在 content", async () => {
    vi.mocked(streamChat).mockImplementationOnce((opts: unknown) => {
      const o = opts as Record<string, (...args: unknown[]) => void>;
      o.onText?.("已经回复了一半");
      o.onError?.("与模型服务的连接中断，请重试", "LLM_CONNECTION_LOST");
      return () => {};
    });

    await useChatStore.getState().sendMessage("查看磁盘");

    const msg = useChatStore.getState().conversations[0].messages[1];
    expect(msg.content).toBe("已经回复了一半");
    expect(msg.errorText).toBe("与模型服务的连接中断，请重试");
    expect(msg.errorCode).toBe("LLM_CONNECTION_LOST");
  });

  it("重试删除失败消息对后重新发起，不产生重复消息", async () => {
    vi.mocked(streamChat)
      .mockImplementationOnce((opts: unknown) => {
        const o = opts as Record<string, (...args: unknown[]) => void>;
        o.onError?.("模型响应超时，请重试", "LLM_TIMEOUT");
        return () => {};
      })
      .mockImplementationOnce((opts: unknown) => {
        const o = opts as Record<string, (...args: unknown[]) => void>;
        o.onText?.("重试成功的回复");
        o.onDone?.("重试成功的回复");
        return () => {};
      });

    await useChatStore.getState().sendMessage("查看内存");
    const convId = useChatStore.getState().currentId!;
    const failed = useChatStore
      .getState()
      .conversations.find((c) => c.id === convId)!.messages[1];
    expect(failed.errorText).toBeTruthy();

    await useChatStore.getState().retryMessage(failed.id);

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0].content).toBe("查看内存");
    expect(conv.messages[1].content).toBe("重试成功的回复");
    expect(conv.messages[1].errorText).toBeUndefined();
  });

  it("仅末条消息可重试：中间轮次的旧失败只留记录", async () => {
    useChatStore.setState({
      conversations: [
        {
          id: "multi",
          title: "多轮",
          agentId: "general",
          contextStatus: "active",
          messages: [
            { id: "u1", role: "user", content: "第一轮", timestamp: 1 },
            {
              id: "a1",
              role: "assistant",
              content: "",
              timestamp: 2,
              errorText: "失败",
              errorCode: "LLM_TIMEOUT",
            },
            { id: "u2", role: "user", content: "第二轮", timestamp: 3 },
            { id: "a2", role: "assistant", content: "第二轮回复", timestamp: 4 },
          ],
          createdAt: 1,
        },
      ],
      currentId: "multi",
    });

    const before = vi.mocked(streamChat).mock.calls.length;
    await useChatStore.getState().retryMessage("a1");

    expect(vi.mocked(streamChat).mock.calls.length).toBe(before);
    expect(
      useChatStore.getState().conversations[0].messages.map((m) => m.id)
    ).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("历史会话与非失败消息不可重试", async () => {
    useChatStore.setState({
      conversations: [
        {
          id: "history",
          title: "历史",
          agentId: "general",
          contextStatus: "history",
          messages: [
            { id: "u1", role: "user", content: "旧问题", timestamp: 1 },
            {
              id: "a1",
              role: "assistant",
              content: "",
              timestamp: 2,
              errorText: "失败",
              errorCode: "LLM_TIMEOUT",
            },
          ],
          createdAt: 1,
        },
      ],
      currentId: "history",
    });

    const before = vi.mocked(streamChat).mock.calls.length;
    await useChatStore.getState().retryMessage("a1");
    expect(vi.mocked(streamChat).mock.calls.length).toBe(before);
  });
});

describe("后端会话失效恢复", () => {
  it("AI_SESSION_EXPIRED 会归档全部活动对话且不自动重发", async () => {
    vi.mocked(streamChat).mockImplementationOnce((opts: unknown) => {
      const o = opts as Record<string, (...args: unknown[]) => void>;
      o.onError?.("AI 服务已重启", "AI_SESSION_EXPIRED");
      return () => {};
    });

    const callsBefore = vi.mocked(streamChat).mock.calls.length;
    await useChatStore.getState().sendMessage("不要自动重发");

    const state = useChatStore.getState();
    const current = state.conversations.find((c) => c.id === state.currentId)!;
    const history = state.conversations.find((c) => c.contextStatus === "history")!;
    expect(current.contextStatus).toBe("active");
    expect(current.messages).toHaveLength(0);
    expect(history.messages[0].content).toBe("不要自动重发");
    expect(history.historyReason).toBe("session_expired");
    expect(state.sessionNotice).toContain("AI 服务已重启");
    // mock 计数跨测试累计，只断言本次恰好发起 1 次（无自动重发）
    expect(vi.mocked(streamChat).mock.calls.length).toBe(callsBefore + 1);
  });
});

describe("深度思考过程可视化（reasoning 事件）", () => {
  it("reasoning 累积写入 assistant 消息并随会话持久化", async () => {
    vi.mocked(streamChat).mockImplementationOnce((opts: unknown) => {
      const o = opts as Record<string, (e?: unknown) => void>;
      o.onReasoning?.("用户在问 TCP");
      o.onReasoning?.("用户在问 TCP，先想握手目的");
      o.onText?.("三次握手用于同步序列号。");
      o.onDone?.("三次握手用于同步序列号。");
      return () => {};
    });
    await useChatStore.getState().sendMessage("TCP 握手");
    const msg = useChatStore.getState().conversations[0].messages[1];
    expect(msg.reasoning).toBe("用户在问 TCP，先想握手目的");
    expect(msg.content).toBe("三次握手用于同步序列号。");
    const persisted = JSON.parse(localStorage.getItem("ai-ssh:chat") as string);
    expect(persisted.state.conversations[0].messages[1].reasoning).toBe(
      "用户在问 TCP，先想握手目的"
    );
  });

  it("无 reasoning 事件的消息不产生 reasoning 字段", async () => {
    await useChatStore.getState().sendMessage("普通问题");
    const msg = useChatStore.getState().conversations[0].messages[1];
    expect(msg.reasoning).toBeUndefined();
  });
});
