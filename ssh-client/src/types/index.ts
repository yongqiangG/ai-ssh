// ===== AI 对话 =====
export type ChatRole = "user" | "assistant";

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  command?: string;
  status?: "running" | "success" | "error";
  output?: string;
  analysis?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  /** 仅 assistant 消息：命令块据此渲染（来自 tool_call / tool_result 事件） */
  toolCalls?: ToolCall[];
}

export interface Conversation {
  id: string;
  title: string;
  agentId: string;
  messages: ChatMessage[];
  createdAt: number;
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
