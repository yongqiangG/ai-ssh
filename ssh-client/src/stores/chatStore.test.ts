import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore";

beforeEach(() => {
  localStorage.clear();
  useChatStore.setState({
    conversations: [],
    currentId: null,
    agentId: "general",
    sending: false,
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
