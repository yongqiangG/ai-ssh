import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Agent, ChatMessage, Conversation, ToolCall } from "../types";
import { createId } from "../utils/id";
import { createSession, queryAgents, streamChat } from "../api/chat";
import { getTerminalSessionId } from "../terminal/terminalManager";
import { useTerminalStore } from "./terminalStore";

interface ChatState {
  agents: Agent[];
  /** loadAgents 的失败信息（null=无错误）；配合 agents 为空时的面板空态展示 */
  agentsError: string | null;
  conversations: Conversation[];
  currentId: string | null;
  /** 下一条消息使用的智能体 */
  agentId: string;
  sending: boolean;
  /** 消息级深度思考开关（逐条不粘滞：发送后自动回落为 false，不持久化） */
  thinkingEnabled: boolean;
  /** 本次会话内「刚到达」的 AI 消息 id（不持久化） */
  freshId: string | null;
  /** 全局历史命令（跨会话共享，去重+提末尾，上限 50，持久化 localStorage） */
  cmdHistory: string[];

  /** 记录一条历史命令（去重+提末尾+上限 50） */
  pushCmdHistory: (cmd: string) => void;

  /** 从后端拉取智能体列表（启动、重试、保存模型设置后调用；总是重新拉取） */
  loadAgents: () => Promise<void>;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  setAgent: (id: string) => void;
  toggleThinking: () => void;
  sendMessage: (text: string) => Promise<void>;
  /** 中止当前流式请求（ChatInputBar 停止按钮调用；running 命令块标为已停止） */
  stop: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const titleFrom = (text: string) => text.trim().slice(0, 24) || "新对话";

/** 当前流式请求的中止函数（sendMessage 写入，stop() 消费） */
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
        agentsError: null,
        conversations: [],
        currentId: null,
        agentId: "",
        sending: false,
        thinkingEnabled: false,
        freshId: null,
        cmdHistory: [],

        loadAgents: async () => {
          // 总是重新拉取：后端可能刚完成装配/换了模型配置，不做本地缓存守卫
          try {
            const list = await queryAgents();
            set((s) => ({
              agents: list,
              agentsError: null,
              // 已选中的 agent 仍存在则保留，否则回落到首个
              agentId: list.some((a) => a.id === s.agentId)
                ? s.agentId
                : list[0]?.id ?? "",
            }));
          } catch (e) {
            const msg = errMsg(e);
            console.error("[chatStore] loadAgents 失败", msg);
            set({ agentsError: msg });
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

        toggleThinking: () =>
          set((s) => ({ thinkingEnabled: !s.thinkingEnabled })),

        pushCmdHistory: (cmd) => {
          const c = cmd.trim();
          if (!c) return;
          set((s) => {
            const filtered = s.cmdHistory.filter((h) => h !== c);
            const next = [...filtered, c];
            if (next.length > 50) next.splice(0, next.length - 50);
            return { cmdHistory: next };
          });
        },

        sendMessage: async (text) => {
          const content = text.trim();
          if (!content || get().sending) return;

          get().pushCmdHistory(content);

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

            // 取活跃终端 sessionId（让 AI 工具能操作用户终端）；无活跃终端则不带
            const activeConnId = useTerminalStore.getState().activeId;
            const terminalSessionId = activeConnId
              ? getTerminalSessionId(activeConnId)
              : null;

            // 深度思考逐条不粘滞：取当前值后立即回落，防止用户忘关一直慢
            const thinkingEnabled = get().thinkingEnabled;
            if (thinkingEnabled) set({ thinkingEnabled: false });

            // 发起流式对话
            abortRef = streamChat({
              agentId,
              sessionId,
              message: content,
              terminalSessionId,
              thinkingEnabled,
              onText: (full) => {
                updateMessage(convId!, assistantId, (m) => ({ ...m, content: full }));
              },
              onToolCall: (e) => {
                // 工具调用开始 → push 到 assistant 消息的 toolCalls
                updateMessage(convId!, assistantId, (m) => ({
                  ...m,
                  toolCalls: [
                    ...(m.toolCalls ?? []),
                    {
                      toolCallId: e.toolCallId ?? "",
                      toolName: e.toolName ?? "",
                      command: e.content,
                      status: "running",
                    } as ToolCall,
                  ],
                }));
              },
              onToolResult: (e) => {
                // 工具执行完成 → 按 toolCallId 配对更新状态/输出
                updateMessage(convId!, assistantId, (m) => ({
                  ...m,
                  toolCalls: (m.toolCalls ?? []).map((tc) =>
                    tc.toolCallId === e.toolCallId
                      ? {
                          ...tc,
                          status: (e.status as ToolCall["status"]) ?? "success",
                          output: e.content,
                          analysis: e.analysis,
                        }
                      : tc
                  ),
                }));
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
          // 中止后把仍在 running 的命令块标为 error，避免永远转圈
          set((s) => ({
            sending: false,
            conversations: s.conversations.map((c) =>
              c.id === s.currentId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.toolCalls?.some((tc) => tc.status === "running")
                        ? {
                            ...m,
                            toolCalls: m.toolCalls.map((tc) =>
                              tc.status === "running"
                                ? { ...tc, status: "error", output: "已停止" }
                                : tc
                            ),
                          }
                        : m
                    ),
                  }
                : c
            ),
          }));
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
        cmdHistory: s.cmdHistory,
      }),
    }
  )
);
