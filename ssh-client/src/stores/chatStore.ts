import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Agent, ChatMessage, Conversation } from "../types";
import { createId } from "../utils/id";
import { createSession, queryAgents, streamChat } from "../api/chat";

interface ChatState {
  agents: Agent[];
  conversations: Conversation[];
  currentId: string | null;
  /** 下一条消息使用的智能体 */
  agentId: string;
  sending: boolean;
  /** 本次会话内「刚到达」的 AI 消息 id（不持久化） */
  freshId: string | null;

  /** 从后端拉取智能体列表（启动时调一次） */
  loadAgents: () => Promise<void>;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  setAgent: (id: string) => void;
  sendMessage: (text: string) => Promise<void>;
  /** 中止当前流式请求（最小闭环前端暂未接停止按钮，预留） */
  stop: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const titleFrom = (text: string) => text.trim().slice(0, 24) || "新对话";

/** 流式请求的中止函数（最小闭环前端暂未接停止按钮，预留） */
let abortRef: (() => void) | null = null;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      /** 不可变更新：更新指定会话的指定消息 */
      const updateMessage = (
        convId: string,
        msgId: string,
        fn: (m: ChatMessage) => ChatMessage
      ) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)) }
              : c
          ),
        }));

      return {
        agents: [],
        conversations: [],
        currentId: null,
        agentId: "",
        sending: false,
        freshId: null,

        loadAgents: async () => {
          // agents 已加载：补全可能为空的 agentId，避免重复请求后仍无默认选中
          if (get().agents.length > 0) {
            if (!get().agentId) set({ agentId: get().agents[0].id });
            return;
          }
          try {
            const list = await queryAgents();
            // 首个 agent 作为默认选中（直接用 list[0]，不保留可能残留的旧 agentId）
            set({ agents: list, agentId: list[0]?.id ?? "" });
          } catch (e) {
            console.error("[chatStore] loadAgents 失败", errMsg(e));
          }
        },

        newConversation: () => {
          const conv: Conversation = {
            id: createId("conv"),
            title: "新对话",
            agentId: get().agentId,
            messages: [],
            createdAt: Date.now(),
          };
          set((s) => ({
            conversations: [conv, ...s.conversations],
            currentId: conv.id,
          }));
        },

        selectConversation: (id) => set({ currentId: id }),

        deleteConversation: (id) =>
          set((s) => {
            const conversations = s.conversations.filter((c) => c.id !== id);
            return {
              conversations,
              currentId:
                s.currentId === id ? conversations[0]?.id ?? null : s.currentId,
            };
          }),

        setAgent: (id) => set({ agentId: id }),

        sendMessage: async (text) => {
          const content = text.trim();
          if (!content || get().sending) return;

          const agentId = get().agentId;
          const userMsg: ChatMessage = {
            id: createId("msg"),
            role: "user",
            content,
            timestamp: Date.now(),
          };
          // 占位的 assistant 消息：流式 onText 会持续更新它的 content
          const assistantMsg: ChatMessage = {
            id: createId("msg"),
            role: "assistant",
            content: "",
            timestamp: Date.now(),
          };
          const assistantId = assistantMsg.id;

          // 确保存在当前会话；没有则新建（含两条消息）
          let convId = get().currentId;
          if (!convId) {
            const conv: Conversation = {
              id: createId("conv"),
              title: titleFrom(content),
              agentId,
              messages: [userMsg, assistantMsg],
              createdAt: Date.now(),
            };
            convId = conv.id;
            set((s) => ({
              conversations: [conv, ...s.conversations],
              currentId: convId,
              sending: true,
              freshId: assistantId,
            }));
          } else {
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      messages: [...c.messages, userMsg, assistantMsg],
                      title: c.messages.length === 0 ? titleFrom(content) : c.title,
                    }
                  : c
              ),
              sending: true,
              freshId: assistantId,
            }));
          }

          const failMsg = (msg: string) =>
            updateMessage(convId!, assistantId, (m) => ({
              ...m,
              content: m.content || `调用失败：${msg}`,
            }));

          try {
            // 获取或创建后端 sessionId
            const conv = get().conversations.find((c) => c.id === convId)!;
            let sessionId = conv.sessionId;
            if (!sessionId) {
              const res = await createSession(agentId);
              sessionId = res.sessionId;
              set((s) => ({
                conversations: s.conversations.map((c) =>
                  c.id === convId ? { ...c, sessionId } : c
                ),
              }));
            }

            // 发起流式对话
            abortRef = streamChat({
              agentId,
              sessionId,
              message: content,
              onText: (full) => {
                updateMessage(convId!, assistantId, (m) => ({ ...m, content: full }));
              },
              onDone: () => {
                abortRef = null;
                set({ sending: false });
              },
              onError: (err) => {
                abortRef = null;
                failMsg(err);
                set({ sending: false });
              },
            });
          } catch (e) {
            failMsg(errMsg(e));
            set({ sending: false });
          }
        },

        stop: () => {
          if (abortRef) {
            abortRef();
            abortRef = null;
          }
          set({ sending: false });
        },
      };
    },
    {
      name: "ai-ssh:chat",
      // sessionId 不持久化：后端 session 在内存，重启即失，每次启动重新建会话
      partialize: (s) => ({
        conversations: s.conversations.map((c) => ({ ...c, sessionId: undefined })),
        currentId: s.currentId,
        agentId: s.agentId,
      }),
    }
  )
);
