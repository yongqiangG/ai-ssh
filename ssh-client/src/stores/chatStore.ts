import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Agent, ChatMessage, Conversation, ToolCall } from "../types";
import { createId } from "../utils/id";
import { confirmDecision, createSession, queryAgents, streamChat } from "../api/chat";
import { getRecentOutput, getTerminalSessionId } from "../terminal/terminalManager";
import { sanitizeTerminalContext } from "../utils/sanitize";
import { useTerminalStore } from "./terminalStore";

/** 待发送的终端引用（F1 选中即问 / F5 报错诊断），随下一条消息一起发出后清除 */
export interface PendingQuote {
  text: string;
  source: "selection" | "error";
}

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
  /** 待发送的终端引用块（F1/F5；随下一条消息发出，不持久化） */
  quote: PendingQuote | null;
  /** 附带终端上下文开关（F3；默认关，刻意逐会话重置，不持久化） */
  attachContext: boolean;
  /** F5 报错检测气泡全局开关（默认开；持久化——关掉是长期意愿不该重启复活） */
  errorDetectEnabled: boolean;

  /** 设置终端引用块（选中即问 / 报错诊断入口调用） */
  setQuote: (quote: PendingQuote | null) => void;
  /** F3 开关 */
  toggleAttachContext: () => void;
  /** F5 全局开关 */
  toggleErrorDetect: () => void;

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
  /** 写操作确认决定（B1）：调 confirm 端点唤醒后端，本地把命令块转回执行态 */
  decideConfirm: (confirmId: string, allow: boolean) => Promise<void>;
  /** 中止当前流式请求（ChatInputBar 停止按钮调用；running 命令块标为已停止） */
  stop: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const titleFrom = (text: string) => text.trim().slice(0, 24) || "新对话";

/**
 * 把指定会话仍在 running / 待确认的命令块统一标为 error（stop 与流 onError 共用）。
 * 断流后若不清理，pending_confirm 确认卡残留可点，点击会把块置回「执行中」
 * 且 tool_result 永远不会到来。
 */
const failPendingToolCalls = (
  conversations: Conversation[],
  convId: string | null,
  output: string
): Conversation[] =>
  conversations.map((c) =>
    c.id === convId
      ? {
          ...c,
          messages: c.messages.map((m) =>
            m.toolCalls?.some(
              (tc) => tc.status === "running" || tc.status === "pending_confirm"
            )
              ? {
                  ...m,
                  toolCalls: m.toolCalls.map((tc) =>
                    tc.status === "running" || tc.status === "pending_confirm"
                      ? { ...tc, status: "error" as const, output, confirmId: undefined }
                      : tc
                  ),
                }
              : m
          ),
        }
      : c
  );

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
        quote: null,
        attachContext: false,
        errorDetectEnabled: true,

        setQuote: (quote) => set({ quote }),
        toggleAttachContext: () => set((s) => ({ attachContext: !s.attachContext })),
        toggleErrorDetect: () =>
          set((s) => ({ errorDetectEnabled: !s.errorDetectEnabled })),

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
          // F1 引用块 + F3 终端上下文：取出后立即清（逐条生效，不粘滞）
          const quote = get().quote;
          const attachContext = get().attachContext;
          if (quote) set({ quote: null });

          // F3：附带活跃终端最近 50 行（脱敏后走独立字段，不进气泡正文）
          let terminalContext: string | null = null;
          if (attachContext) {
            const activeId = useTerminalStore.getState().activeId;
            const recent = activeId ? getRecentOutput(activeId, 50) : null;
            terminalContext = recent ? sanitizeTerminalContext(recent) : null;
          }

          const userMsg: ChatMessage = {
            id: createId("msg"),
            role: "user",
            content,
            timestamp: Date.now(),
            quote: quote?.text,
            contextLines: terminalContext ? terminalContext.split("\n").length : undefined,
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

            // 发起流式对话；引用块拼进请求 message（展示层只存 userMsg.quote 折叠渲染）
            const requestMessage = quote
              ? `[引用终端输出]\n${quote.text}\n[/引用]\n\n${content}`
              : content;
            abortRef = streamChat({
              agentId,
              sessionId,
              message: requestMessage,
              terminalContext,
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
                          confirmId: undefined,
                        }
                      : tc
                  ),
                }));
              },
              onConfirmRequest: (e) => {
                // 写操作确认（B1）：按 toolCallId 把对应命令块置为待确认态；
                // toolCallId 缺失时兜底挂到最后一个 running 块（工具串行执行，即当前块）
                updateMessage(convId!, assistantId, (m) => {
                  const list = m.toolCalls ?? [];
                  let targetIdx = list.findIndex(
                    (tc) => tc.toolCallId && tc.toolCallId === e.toolCallId
                  );
                  if (targetIdx < 0) {
                    for (let i = list.length - 1; i >= 0; i--) {
                      if (list[i].status === "running") {
                        targetIdx = i;
                        break;
                      }
                    }
                  }
                  if (targetIdx < 0) return m;
                  return {
                    ...m,
                    toolCalls: list.map((tc, i) =>
                      i === targetIdx
                        ? {
                            ...tc,
                            status: "pending_confirm" as const,
                            confirmId: e.confirmId,
                            analysis: e.analysis,
                          }
                        : tc
                    ),
                  };
                });
              },
              onDone: () => {
                abortRef = null;
                set({ sending: false });
              },
              onError: (err) => {
                abortRef = null;
                failMsg(err);
                // 断流后清理残留命令块（与 stop 同语义），避免确认卡悬挂可点
                set((s) => ({
                  sending: false,
                  conversations: failPendingToolCalls(s.conversations, convId, "已中断"),
                }));
              },
            });
          } catch (e) {
            failMsg(errMsg(e));
            set({ sending: false });
          }
        },

        decideConfirm: async (confirmId, allow) => {
          try {
            await confirmDecision(confirmId, allow);
          } finally {
            // 本地把匹配的命令块转回执行态；拒绝时后端随即发 tool_result=error 覆盖为终态
            set((s) => ({
              conversations: s.conversations.map((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.toolCalls?.some((tc) => tc.confirmId === confirmId)
                    ? {
                        ...m,
                        toolCalls: m.toolCalls.map((tc) =>
                          tc.confirmId === confirmId
                            ? { ...tc, status: "running" as const, confirmId: undefined }
                            : tc
                        ),
                      }
                    : m
                ),
              })),
            }));
          }
        },

        stop: () => {
          if (abortRef) {
            abortRef();
            abortRef = null;
          }
          // 中止后把仍在 running / 待确认的命令块标为 error，避免永远转圈
          set((s) => ({
            sending: false,
            conversations: failPendingToolCalls(s.conversations, s.currentId, "已停止"),
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
        errorDetectEnabled: s.errorDetectEnabled,
      }),
    }
  )
);
