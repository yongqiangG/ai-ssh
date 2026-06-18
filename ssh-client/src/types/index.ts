// ===== SSH 服务器配置 =====
export type AuthMethod = "password" | "key";

export interface SshServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  privateKey?: string;
  /** 可选分组，用于在列表里归类展示 */
  group?: string;
  createdAt: number;
}

// ===== AI 对话 =====
export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  agentId: string;
  messages: ChatMessage[];
  createdAt: number;
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

// ===== Service 接口（当前 mock 实现，将来替换为后端 HTTP 调用） =====
// UI 仅依赖接口，不依赖具体实现，确保后端就绪时只替换 utils 下的实现。
export interface SshService {
  /** 建立连接；失败时抛出描述性异常 */
  connect(config: SshServer): Promise<void>;
  /** 执行命令，通过 onData 流式回传输出 */
  exec(command: string, onData: (data: string) => void): Promise<void>;
  /** 断开连接 */
  disconnect(): Promise<void>;
}

export interface AiService {
  /** 预设智能体列表（将来从后端获取） */
  readonly agents: Agent[];
  /** 发送消息并返回 AI 回复（将来对接真实模型） */
  sendMessage(
    text: string,
    agentId: string,
    history: ChatMessage[]
  ): Promise<string>;
}
