import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Agent, ChatMessage, Conversation } from "../types";
import { createId } from "../utils/id";
import { createMockAiService } from "../utils/mockAi";

interface ChatState {
  agents: Agent[];
  conversations: Conversation[];
  currentId: string | null;
  /** 下一条消息使用的智能体 */
  agentId: string;
  sending: boolean;

  newConversation: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  setAgent: (id: string) => void;
  sendMessage: (text: string) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const titleFrom = (text: string) => text.trim().slice(0, 24) || "新对话";

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      const ai = createMockAiService();

      /** 在当前会话追加一条消息（不可变更新） */
      const appendMessage = (convId: string, msg: ChatMessage) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? { ...c, messages: [...c.messages, msg] } : c
          ),
        }));

      return {
        agents: ai.agents,
        conversations: [],
        currentId: null,
        agentId: ai.agents[0]?.id ?? "general",
        sending: false,

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

          // 确保存在当前会话；没有则新建
          let convId = get().currentId;
          if (!convId) {
            const conv: Conversation = {
              id: createId("conv"),
              title: titleFrom(content),
              agentId,
              messages: [userMsg],
              createdAt: Date.now(),
            };
            convId = conv.id;
            set((s) => ({
              conversations: [conv, ...s.conversations],
              currentId: convId,
              sending: true,
            }));
          } else {
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      messages: [...c.messages, userMsg],
                      title: c.messages.length === 0 ? titleFrom(content) : c.title,
                    }
                  : c
              ),
              sending: true,
            }));
          }

          const history =
            get().conversations.find((c) => c.id === convId)?.messages ?? [];

          try {
            const reply = await ai.sendMessage(content, agentId, history);
            appendMessage(convId, {
              id: createId("msg"),
              role: "assistant",
              content: reply,
              timestamp: Date.now(),
            });
          } catch (e) {
            appendMessage(convId, {
              id: createId("msg"),
              role: "assistant",
              content: `调用失败：${errMsg(e)}`,
              timestamp: Date.now(),
            });
          } finally {
            set({ sending: false });
          }
        },
      };
    },
    {
      name: "ai-ssh:chat",
      partialize: (s) => ({
        conversations: s.conversations,
        currentId: s.currentId,
        agentId: s.agentId,
      }),
    }
  )
);
