/**
 * SSH 终端场景对接：封装服务端 /api/ssh/terminals 下的 6 个接口。
 *
 * 交互模型（轮询式）：
 * - 打开会话拿到 sessionId 与初始输出（motd + 提示符，服务端积累完一次性返回）；
 * - 用户按键经 write 原样透传（前端做 10ms 合批，见 terminalManager）；
 * - 输出由前端每 50ms 调 read 拉取增量；closed=true 表示后端 shell 通道已断；
 * - AI 执行命令走 command（整行、服务端补换行），输出同样经 read 流回。
 */
import { http } from "./request";

/** 打开终端会话的返回：sessionId + 初始输出 */
export interface TerminalOpenResult {
  sessionId: string;
  /** motd + 首个提示符，可能为空字符串 */
  output: string;
}

/** 读取终端输出的返回 */
export interface TerminalReadResult {
  /** 自上次读取以来的增量输出，无新输出为空字符串 */
  content: string;
  /** 后端断联标记：shell 通道已关闭，前端应停止轮询 */
  closed: boolean;
}

const BASE = "/api/ssh/terminals";

/** 打开终端会话；cols/rows 为 xterm 实际尺寸，用于远端 pty 初始化 */
export function openTerminal(
  connectionId: string,
  cols: number,
  rows: number
): Promise<TerminalOpenResult> {
  return http.post<TerminalOpenResult>(`${BASE}/open`, {
    connectionId,
    cols,
    rows,
  });
}

/** 执行整行命令（AI 场景，服务端自动补换行） */
export function sendTerminalCommand(
  sessionId: string,
  command: string
): Promise<void> {
  return http.post<void>(`${BASE}/${sessionId}/command`, { command });
}

/** 逐字节原样写入（用户键入、控制序列透传） */
export function writeTerminal(sessionId: string, data: string): Promise<void> {
  return http.post<void>(`${BASE}/${sessionId}/write`, { data });
}

/** 读取增量输出 + 后端断联标记 */
export function readTerminal(sessionId: string): Promise<TerminalReadResult> {
  return http.get<TerminalReadResult>(`${BASE}/${sessionId}/read`);
}

/** 调整远端伪终端窗口尺寸 */
export function resizeTerminal(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  return http.post<void>(`${BASE}/${sessionId}/resize`, { cols, rows });
}

/** 关闭终端会话（幂等） */
export function closeTerminal(sessionId: string): Promise<void> {
  return http.post<void>(`${BASE}/${sessionId}/close`);
}
