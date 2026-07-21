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
  event: "text" | "tool_call" | "tool_result" | "round_end" | "done" | "error";
  content?: string;
  fullText?: string;
  toolCallId?: string;
  toolName?: string;
  status?: string;
  /** 工具失败时的中文建议（tool_result，对应后端 ReActEventDTO.analysis） */
  analysis?: string;
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
  /** 消息级深度思考开关（默认 false）；true 时后端不注入 thinking.disabled */
  thinkingEnabled?: boolean;
  /** 收到累积全文（text 事件）时回调，前端据此整体替换消息 content */
  onText: (fullText: string) => void;
  /** 工具调用开始（tool_call 事件）：content 为命令文本 */
  onToolCall?: (e: ReActEvent) => void;
  /** 工具执行完成（tool_result 事件）：content 为输出，analysis 为失败建议 */
  onToolResult?: (e: ReActEvent) => void;
  /** 流正常结束（reader done）时回调 */
  onDone: (finalText: string) => void;
  /** 出错回调 */
  onError: (err: string) => void;
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
      opts.onError(evt.content ?? "未知错误");
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
    // round_end：前端不渲染时间线，忽略
  }
}
