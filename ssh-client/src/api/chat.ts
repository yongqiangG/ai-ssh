/**
 * AI 对话 API —— 对接后端 /api/v1/agents、/api/v1/sessions、/api/v1/chat_stream。
 *
 * - agents / sessions：普通 REST，复用 {@link http}（自动解包 ApiResponse）。
 * - chat_stream：**NDJSON 流式**（后端用 ResponseBodyEmitter 每行发一个 JSON + '\n'）。
 *   不是标准 SSE（POST + JSON body），故不能用 EventSource，必须 fetch + ReadableStream 手动按行解析。
 *   参照 WaLiSSH walissh-client/src/api/agent.ts。
 */
import { getBaseUrl, getUserId, http } from "./request";
import type { Agent } from "../types";

/** 后端 ReAct 事件（ReActEventDTO） */
export interface ReActEvent {
  event:
    | "text"
    | "reasoning"
    | "tool_call"
    | "tool_result"
    | "confirm_request"
    | "round_end"
    | "done"
    | "error";
  code?: string;
  content?: string;
  fullText?: string;
  toolCallId?: string;
  toolName?: string;
  status?: string;
  /** 工具失败时的中文建议（tool_result）；confirm_request 时为判定理由 */
  analysis?: string;
  /** 写操作确认 ID（confirm_request 时；携带它调 confirmDecision 放行/拒绝） */
  confirmId?: string;
  stepInfo?: {
    currentStep: number;
    maxSteps: number;
    shouldContinue: boolean;
    totalToolCalls: number;
  };
}

/** 后端 AgentDTO 原始字段（与前端 Agent 的 id/name/description 不同名，需映射） */
interface AgentDTO {
  agentId: string;
  agentName: string;
  agentDesc: string;
}

/** 查询已装配智能体列表，并把后端字段映射为前端 Agent */
export async function queryAgents(): Promise<Agent[]> {
  const list = await http.get<AgentDTO[]>("/api/v1/agents");
  return list.map((a) => ({ id: a.agentId, name: a.agentName, description: a.agentDesc }));
}

/** 创建会话，返回 sessionId */
export function createSession(agentId: string): Promise<{ sessionId: string }> {
  return http.post<{ sessionId: string }>("/api/v1/sessions", {
    agentId,
    userId: getUserId(),
  });
}

export interface StreamChatOptions {
  agentId: string;
  sessionId: string;
  message: string;
  /** 当前活跃终端 sessionId（让 AI 工具能操作用户终端）；null/undefined 时不带 */
  terminalSessionId?: string | null;
  /** 终端上下文快照（F3；已脱敏的最近 N 行，独立字段不进 message 正文）；null 时不带 */
  terminalContext?: string | null;
  /** 消息级深度思考开关（默认 false）；true 时后端不注入 thinking.disabled */
  thinkingEnabled?: boolean;
  /** 收到累积全文（text 事件）时回调，前端据此整体替换消息 content */
  onText: (fullText: string) => void;
  /** 深度思考片段（reasoning 事件）：fullReasoning 为累积思维链，整体替换渲染 */
  onReasoning?: (fullReasoning: string) => void;
  /** 工具调用开始（tool_call 事件）：content 为命令文本 */
  onToolCall?: (e: ReActEvent) => void;
  /** 工具执行完成（tool_result 事件）：content 为输出，analysis 为失败建议 */
  onToolResult?: (e: ReActEvent) => void;
  /** 写操作确认请求（confirm_request 事件）：后端工具挂起等待，前端渲染允许/拒绝（B1） */
  onConfirmRequest?: (e: ReActEvent) => void;
  /** 流正常结束（reader done）时回调 */
  onDone: (finalText: string) => void;
  /** 出错回调 */
  onError: (err: string, code?: string) => void;
}

/**
 * NDJSON 流式对话。
 *
 * 协议：POST /api/v1/chat_stream，响应体每行一个 ReActEvent 的 JSON。
 * 处理的事件：
 * - text：fullText 为累积全文 → onText(fullText)
 * - done：content 是 ReActResultDTO 的 JSON，取其 content 作为最终文本
 * - error：content 为错误信息
 * 返回一个 abort 函数（chatStore.stop 经 abortRef 调用它实现停止）。
 */
export function streamChat(opts: StreamChatOptions): () => void {
  const controller = new AbortController();
  const url = getBaseUrl() + "/api/v1/chat_stream";
  let lastFullText = "";

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": getUserId(),
    },
    body: JSON.stringify({
      agentId: opts.agentId,
      userId: getUserId(),
      sessionId: opts.sessionId,
      message: opts.message,
      ...(opts.terminalSessionId ? { terminalSessionId: opts.terminalSessionId } : {}),
      ...(opts.terminalContext ? { terminalContext: opts.terminalContext } : {}),
      ...(opts.thinkingEnabled ? { thinkingEnabled: true } : {}),
    }),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) {
        opts.onError(`HTTP ${res.status}: ${res.statusText}`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        opts.onError("无响应体");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";

      const read = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              opts.onDone(lastFullText);
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            // 按换行切行；最后一行可能不完整，留在 buffer 等下一个 chunk
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const evt: ReActEvent = JSON.parse(trimmed);
                handleEvent(evt, opts, (t) => {
                  lastFullText = t;
                });
              } catch {
                // 非 JSON 行（HTTP chunk 边界噪声），忽略
              }
            }
            read();
          })
          .catch((err) => {
            if (err?.name !== "AbortError") opts.onError(err.message ?? String(err));
          });
      };
      read();
    })
    .catch((err) => {
      if (err?.name !== "AbortError") opts.onError(err.message ?? String(err));
    });

  return () => controller.abort();
}

/** 单事件分发 */
function handleEvent(
  evt: ReActEvent,
  opts: StreamChatOptions,
  setLast: (t: string) => void
): void {
  switch (evt.event) {
    case "text": {
      const full = evt.fullText ?? evt.content ?? "";
      setLast(full);
      opts.onText(full);
      break;
    }
    case "reasoning": {
      opts.onReasoning?.(evt.fullText ?? evt.content ?? "");
      break;
    }
    case "done": {
      // done.content 是 ReActResultDTO 的 JSON，取其 content 字段作为最终文本
      let finalText = "";
      try {
        const result = JSON.parse(evt.content ?? "");
        finalText = result.content ?? "";
      } catch {
        finalText = evt.content ?? "";
      }
      if (finalText) {
        setLast(finalText);
        opts.onText(finalText);
      }
      break;
    }
    case "error": {
      opts.onError(evt.content ?? "未知错误", evt.code);
      break;
    }
    case "tool_call": {
      opts.onToolCall?.(evt);
      break;
    }
    case "tool_result": {
      opts.onToolResult?.(evt);
      break;
    }
    case "confirm_request": {
      opts.onConfirmRequest?.(evt);
      break;
    }
    // round_end：前端不渲染时间线，忽略
  }
}

/** 写操作确认决定：用户点「允许/拒绝」后调用，唤醒后端挂起的工具线程 */
export function confirmDecision(confirmId: string, allow: boolean): Promise<boolean> {
  return http.post<boolean>("/api/v1/chat/confirm", { confirmId, allow });
}
