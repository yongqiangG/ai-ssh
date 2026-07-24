// ===== AI 对话 =====
export type ChatRole = "user" | "assistant";

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  command?: string;
  status?: "running" | "pending_confirm" | "success" | "error";
  output?: string;
  analysis?: string;
  /** 写操作确认 ID（status=pending_confirm 时；允许/拒绝按钮携带它调 confirm 端点） */
  confirmId?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  /** 仅 assistant 消息：命令块据此渲染（来自 tool_call / tool_result 事件） */
  toolCalls?: ToolCall[];
  /** 仅 assistant 消息：深度思考过程（思维链，reasoning 事件累积）；随会话持久化供回看 */
  reasoning?: string;
  /** 仅 user 消息：终端引用块（F1 选中即问 / F5 报错诊断），气泡内折叠渲染 */
  quote?: string;
  /** 仅 user 消息：随消息附带的终端上下文行数（F3；正文不进气泡，仅显示小标签） */
  contextLines?: number;
  /** 仅 assistant 消息：调用失败的人话提示（存在即失败；content 保留可能的半截回复） */
  errorText?: string;
  /** 仅 assistant 消息：失败机器码（LLM_* / AI_SESSION_EXPIRED），决定是否显示重试按钮 */
  errorCode?: string;
}

export interface Conversation {
  id: string;
  title: string;
  agentId: string;
  messages: ChatMessage[];
  createdAt: number;
  contextStatus?: "active" | "history";
  historyReason?: "app_restarted" | "model_reloaded" | "session_expired";
  /** 后端会话 ID（ADK sessionId）；不持久化，每次启动重新创建 */
  sessionId?: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
}

// ===== 连接状态 =====
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";
