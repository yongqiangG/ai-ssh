/**
 * SSH 连接场景对接：把 {@link ./request.ts} 的通用方法组合成具体业务调用。
 *
 * 服务端基础路径 /api/ssh/connections；认证类型与状态编码与服务端枚举对齐。
 */
import { http } from "./request";
import type { ConnectionState } from "../types";

/** 认证类型，对应服务端 AuthTypeEnum.code */
export type AuthType = "PASSWORD" | "PUBLIC_KEY";

/** 服务端返回的连接原始结构（status 为编码 0/1） */
export interface SshConnectionDTO {
  connectionId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password: string;
  privateKey: string;
  /** 0=未连接，1=已连接 */
  status: number;
  userId: string;
  connectTimeout: number;
  keepaliveInterval: number;
  startupCommand: string;
  knownHosts: string;
  strictHostKeyCheck: boolean;
  compression: boolean;
}

/** 客户端视图模型：服务端字段 + 客户端态状态（含 connecting/error 瞬态） */
export interface SshConnection extends Omit<SshConnectionDTO, "status"> {
  status: ConnectionState;
}

/** 新建/编辑提交体 */
export interface SshConnectionPayload {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
  connectTimeout?: number;
  keepaliveInterval?: number;
  startupCommand?: string;
  knownHosts?: string;
  strictHostKeyCheck?: boolean;
  compression?: boolean;
}

const BASE = "/api/ssh/connections";

/** 服务端状态编码 → 客户端状态 */
function toConnectionState(code: number): ConnectionState {
  return code === 1 ? "connected" : "disconnected";
}

/** DTO → 视图模型 */
export function toConnection(dto: SshConnectionDTO): SshConnection {
  const { status, ...rest } = dto;
  return { ...rest, status: toConnectionState(status) };
}

export function listConnections(): Promise<SshConnectionDTO[]> {
  return http.get<SshConnectionDTO[]>(BASE);
}

export function getConnection(id: string): Promise<SshConnectionDTO> {
  return http.get<SshConnectionDTO>(`${BASE}/${id}`);
}

export function createConnection(
  payload: SshConnectionPayload
): Promise<string> {
  return http.post<string>(BASE, payload);
}

export function updateConnection(
  id: string,
  payload: Partial<SshConnectionPayload>
): Promise<void> {
  return http.put<void>(`${BASE}/${id}`, payload);
}

export function deleteConnection(id: string): Promise<void> {
  return http.del<void>(`${BASE}/${id}`);
}

export function connectConnection(id: string): Promise<boolean> {
  return http.post<boolean>(`${BASE}/${id}/connect`);
}

export function disconnectConnection(id: string): Promise<void> {
  return http.post<void>(`${BASE}/${id}/disconnect`);
}

/** 实时连接状态（是否已连接） */
export function getConnectionStatus(id: string): Promise<boolean> {
  return http.get<boolean>(`${BASE}/${id}/status`);
}
