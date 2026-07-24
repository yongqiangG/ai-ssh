import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Agent, ChatMessage, Conversation, ToolCall } from "../types";
import { createId } from "../utils/id";
import { confirmDecision, createSession, queryAgents, streamChat } from "../api/chat";
import { humanizeClientError } from "../utils/llmError";
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
  /** 深度思考开关（默认开：SSH 运维场景偏复杂、答错代价高于等待；会话内粘滞：
   *  手动关掉后保持到会话结束；不持久化，重启回默认开。推翻 260723 默认关决议，
   *  见 docs/situations/260723-ux-thinking-confirm.md 补录 */
  thinkingEnabled: boolean;
  /** 本次会话内「刚到达」的 AI 消息 id（不持久化） */
  freshId: string | null;
  /** 全局历史命令（跨会话共享，去重+提末尾，上限 50，持久化 localStorage） */
  cmdHistory: string[];
  /** 待发送的终端引用块（F1/F5；随下一条消息发出，不持久化） */
  quote: PendingQuote | null;
  /** 附带终端上下文开关（F3；默认关，刻意逐会话重置，不持久化） */
  attachContext: boolean;
  /** F5 报错检测气泡全局开关（默认关，用户按需开启；持久化——开关是长期意愿不该重启丢失） */
  errorDetectEnabled: boolean;
  /** 会话状态提示（模型重载 / 冷启动 / 会话失效后提示用户） */
  sessionNotice: string | null;

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
  clearSessionNotice: () => void;
  archiveAllAndStartNew: (
    reason: "app_restarted" | "model_reloaded" | "session_expired",
    notice: string
  ) => void;
  setAgent: (id: string) => void;
  toggleThinking: () => void;
  sendMessage: (text: string) => Promise<void>;
  /** 手动重试失败的 AI 回复：删除失败消息对后走标准 sendMessage 全流程（不自动重发） */
  retryMessage: (messageId: string) => Promise<void>;
  /** 写操作确认决定（B1）：调 confirm 端点唤醒后端，本地把命令块转回执行态 */
  decideConfirm: (confirmId: string, allow: boolean) => Promise<void>;
  /** 中止当前流式请求（ChatInputBar 停止按钮调用；running 命令块标为已停止） */
  stop: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const titleFrom = (text: string) => text.trim().slice(0, 24) || "新对话";

/**
 * 把仍在 running / 待确认的命令块统一标为 error（stop、流 onError、归档共用）。
 * 断流后若不清理，pending_confirm 确认卡残留可点，点击会把块置回「执行中」
 * 且 tool_result 永远不会到来。
 */
const failActiveToolCalls = (
  messages: ChatMessage[],
  output: string
): ChatMessage[] =>
  messages.map((m) =>
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
  );

const failPendingToolCalls = (
  conversations: Conversation[],
  convId: string | null,
  output: string
): Conversation[] =>
  conversations.map((c) =>
    c.id === convId ? { ...c, messages: failActiveToolCalls(c.messages, output) } : c
  );

/** 当前流式请求的中止函数（sendMessage 写入，stop() 消费） */
let abortRef: (() => void) | null = null;

/** 持久化到 localStorage 的字段子集（partialize 产出、migrate 透传，两处共用此形状） */
interface PersistedChatState {
  conversations: Conversation[];
  currentId: string | null;
  agentId: string;
  cmdHistory: string[];
  errorDetectEnabled: boolean;
}

const createBlankConversation = (agentId: string): Conversation => ({
  id: createId("conv"),
  title: "新对话",
  agentId,
  messages: [],
  createdAt: Date.now(),
  contextStatus: "active",
});

/**
 * 归档即终局：历史会话不该携带「进行中」——僵尸 running/pending_confirm 块
 * 会永远转圈，还会让设置弹窗的「会话进行中」拦截永久误判（保存被锁死）。
 * 已是 history 的对话也重跑一遍清理，顺带自愈旧持久化数据。
 */
const archiveConversation = (
  conversation: Conversation,
  reason: "app_restarted" | "model_reloaded" | "session_expired"
): Conversation => {
  if (conversation.messages.length === 0) {
    return conversation;
  }
  return {
    ...conversation,
    contextStatus: "history",
    historyReason:
      conversation.contextStatus === "history"
        ? conversation.historyReason ?? reason
        : reason,
    sessionId: undefined,
    messages: failActiveToolCalls(conversation.messages, "已随会话归档中断"),
  };
};

const normalizeConversationList = (
  conversations: Conversation[],
  reason: "app_restarted" | "model_reloaded" | "session_expired"
): Conversation[] => conversations
  .filter((c) => c.messages.length > 0)
  .map((c) => archiveConversation(c, reason));

const restoreChatState = (persisted: PersistedChatState | undefined): PersistedChatState => {
  const conversations = normalizeConversationList(persisted?.conversations ?? [], "app_restarted");
  const agentId = persisted?.agentId ?? "";
  const blank = createBlankConversation(agentId);
  return {
    conversations: [blank, ...conversations],
    currentId: blank.id,
    agentId,
    cmdHistory: persisted?.cmdHistory ?? [],
    errorDetectEnabled: persisted?.errorDetectEnabled ?? false,
  };
};

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
        thinkingEnabled: true,
        freshId: null,
        cmdHistory: [],
        quote: null,
        attachContext: false,
        errorDetectEnabled: false,
        sessionNotice: null,

        setQuote: (quote) => set({ quote }),
        toggleAttachContext: () => set((s) => ({ attachContext: !s.attachContext })),
        toggleErrorDetect: () =>
          set((s) => ({ errorDetectEnabled: !s.errorDetectEnabled })),
        clearSessionNotice: () => set({ sessionNotice: null }),

        archiveAllAndStartNew: (reason, notice) =>
          set((s) => {
            const archived = normalizeConversationList(s.conversations, reason);
            const blank = createBlankConversation(s.agentId);
            return {
              conversations: [blank, ...archived],
              currentId: blank.id,
              sending: false,
              sessionNotice: notice,
              freshId: null,
            };
          }),

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
          const conv = createBlankConversation(get().agentId);
          set((s) => ({
            conversations: [conv, ...s.conversations],
            currentId: conv.id,
            sessionNotice: null,
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

          const currentConv = get().conversations.find((c) => c.id === get().currentId);
          if (currentConv?.contextStatus === "history") return;

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
              contextStatus: "active",
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
                      contextStatus: c.contextStatus ?? "active",
                    }
                  : c
              ),
              sending: true,
              freshId: assistantId,
            }));
          }

          const failMsg = (msg: string, code?: string) =>
            updateMessage(convId!, assistantId, (m) => ({
              ...m,
              // 后端带 code 时 msg 已是人话；否则是 fetch 层错误做兜底翻译。
              // content 保留可能的半截回复，错误条独立渲染；?? 保证流断的
              // 第二次 onError 不覆盖首个错误
              errorText: m.errorText ?? (code ? msg : humanizeClientError(msg)),
              errorCode: m.errorCode ?? code,
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

            // 深度思考会话内粘滞：只取值不回落，保持到用户手动关闭
            const thinkingEnabled = get().thinkingEnabled;

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
              onReasoning: (full) => {
                // 深度思考思维链：整体替换（后端 fullText 已累积）；随消息持久化供回看
                updateMessage(convId!, assistantId, (m) => ({ ...m, reasoning: full }));
              },
              onToolCall: (e) => {
                // 工具调用开始 → push 到 assistant 消息的 toolCalls。
                // fail-safe 去重：confirm_request 先到时已按本事件同 id 建了孤儿确认卡
                // （见 onConfirmRequest），此时不再新建，保持确认态等用户点击
                updateMessage(convId!, assistantId, (m) => {
                  const list = m.toolCalls ?? [];
                  const id = e.toolCallId ?? "";
                  if (list.some((tc) => tc.toolCallId === id && tc.status === "pending_confirm")) {
                    return m;
                  }
                  return {
                    ...m,
                    toolCalls: [
                      ...list,
                      {
                        toolCallId: id,
                        toolName: e.toolName ?? "",
                        command: e.content,
                        status: "running",
                      } as ToolCall,
                    ],
                  };
                });
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
                // toolCallId 缺失时兜底挂到最后一个 running 块（工具串行执行，即当前块）；
                // 都找不到（confirm_request 由工具线程直写 NDJSON，可能先于 tool_call 到达）
                // 则以事件自带信息新建孤儿确认卡——后端 ConfirmGate 正挂起等点击，
                // 静默丢弃会让用户无处可点、120s 超时被拒（B2 卡死缺陷的根因）
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
                  if (targetIdx < 0) {
                    return {
                      ...m,
                      toolCalls: [
                        ...list,
                        {
                          toolCallId: e.toolCallId ?? "",
                          toolName: e.toolName ?? "executeCommand",
                          command: e.content ?? "",
                          status: "pending_confirm",
                          confirmId: e.confirmId,
                          analysis: e.analysis,
                        } as ToolCall,
                      ],
                    };
                  }
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
                // 流正常结束后不可能再有 tool_result 到来——仍在 running/待确认的块
                // （后端异常路径漏发结果/单行 JSON 损坏被忽略）收敛为终态，
                // 避免永久转圈 + 误触发「会话进行中」的配置保存拦截
                set((s) => ({
                  sending: false,
                  conversations: failPendingToolCalls(s.conversations, convId, "已结束"),
                }));
              },
              onError: (err, code) => {
                abortRef = null;
                failMsg(err, code);
                // 断流后清理残留命令块（与 stop 同语义），避免确认卡悬挂可点
                set((s) => ({
                  sending: false,
                  conversations: failPendingToolCalls(s.conversations, convId, "已中断"),
                }));
                if (code === "AI_SESSION_EXPIRED") {
                  get().archiveAllAndStartNew(
                    "session_expired",
                    `AI 会话已失效：${err}`
                  );
                }
              },
            });
          } catch (e) {
            failMsg(errMsg(e));
            set({ sending: false });
          }
        },

        retryMessage: async (messageId) => {
          if (get().sending) return;
          const conv = get().conversations.find((c) => c.id === get().currentId);
          if (!conv || conv.contextStatus === "history") return;
          const idx = conv.messages.findIndex((m) => m.id === messageId);
          // 仅末条可重试：中间轮次重发会把消息对挪到末尾（阅读顺序与后端
          // 上下文顺序都被打乱），旧失败留错误条做记录即可
          if (idx < 0 || idx !== conv.messages.length - 1) return;
          if (!conv.messages[idx].errorText) return;
          const userMsg = conv.messages[idx - 1];
          if (!userMsg || userMsg.role !== "user") return;
          // 删除失败消息对 + 复原引用块，走标准 sendMessage 全流程；
          // 终端上下文按当前开关重取（不复刻失败时快照），主发送路径零改动
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    messages: c.messages.filter(
                      (m) => m.id !== messageId && m.id !== userMsg.id
                    ),
                  }
                : c
            ),
            quote: userMsg.quote
              ? { text: userMsg.quote, source: "selection" as const }
              : s.quote,
          }));
          await get().sendMessage(userMsg.content);
        },

        decideConfirm: async (confirmId, allow) => {
          const updateByConfirmId = (fn: (tc: ToolCall) => ToolCall) =>
            set((s) => ({
              conversations: s.conversations.map((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.toolCalls?.some((tc) => tc.confirmId === confirmId)
                    ? {
                        ...m,
                        toolCalls: m.toolCalls.map((tc) =>
                          tc.confirmId === confirmId ? fn(tc) : tc
                        ),
                      }
                    : m
                ),
              })),
            }));

          // 乐观转执行态但保留 confirmId：请求期间确认卡消失（防重复点击），
          // 失败时凭 confirmId 找回该块恢复待确认。tool_result 先到会清掉
          // confirmId，此后所有 updateByConfirmId 匹配不中 → 天然幂等不覆盖终态
          updateByConfirmId((tc) => ({ ...tc, status: "running" as const }));
          try {
            const found = await confirmDecision(confirmId, allow);
            if (found) {
              // 后端已唤醒：拒绝时随即有 tool_result=error 覆盖终态；允许则等执行结果
              updateByConfirmId((tc) => ({ ...tc, confirmId: undefined }));
            } else {
              // 确认已超时清理/confirmId 无效：后端早按拒绝收尾，对齐终态而不是转圈
              updateByConfirmId((tc) => ({
                ...tc,
                status: "error" as const,
                confirmId: undefined,
                output: "确认已过期（等待超过 120 秒），命令未执行",
              }));
            }
          } catch (e) {
            // 后端没收到决定（网络失败）：恢复待确认，卡片重新可点，绝不假装成功
            updateByConfirmId((tc) => ({ ...tc, status: "pending_confirm" as const }));
            console.error("[chatStore] 确认决定发送失败", errMsg(e));
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
      // v1：errorDetectEnabled 默认从开改关。v0 时代默认值 true 会随持久化写盘，
      // 旧值无法区分「用户意愿」还是「默认值快照」，迁移时一次性删除让新默认接管；
      // v1 起用户手动开启的值正常持久化，不再被重置。
      version: 2,
      migrate: (persisted, version) => {
        if (version < 1 && persisted && typeof persisted === "object") {
          delete (persisted as Record<string, unknown>).errorDetectEnabled;
        }
        // 归档与新建空白对话统一在 merge 的 restoreChatState 做，此处只做字段级迁移
        return persisted as PersistedChatState;
      },
      // sessionId 不持久化：后端 session 在内存，重启即失，每次启动重新建会话。
      // contextStatus 保留真实值：merge 靠它区分「上次有活动对话被归档」（弹横幅
      // 解释一次）与「全是老历史」（安静启动）——写盘时强制 history 会丢掉该信息
      partialize: (s): PersistedChatState => ({
        conversations: s.conversations
          .filter((c) => c.messages.length > 0)
          .map((c) => ({ ...c, sessionId: undefined })),
        currentId: s.currentId,
        agentId: s.agentId,
        cmdHistory: s.cmdHistory,
        errorDetectEnabled: s.errorDetectEnabled,
      }),
      merge: (persisted, current) => {
        const p = persisted as PersistedChatState | undefined;
        const hadActive = (p?.conversations ?? []).some(
          (c) => c.messages.length > 0 && c.contextStatus !== "history"
        );
        return {
          ...current,
          ...restoreChatState(p),
          sessionNotice: hadActive ? "应用已重新启动，原对话已转为历史" : null,
        };
      },
    }
  )
);
