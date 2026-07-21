/**
 * SSH 密钥场景对接（一等实体 CRUD）。
 *
 * 服务端基础路径 /api/ssh/keys；privateKey/passphrase 只写不回显，
 * 编辑回填依赖 passphraseConfigured 布尔（与连接凭据同约定）。
 */
import { http } from "./request";

export interface SshKeyDTO {
  keyId: string;
  name: string;
  /** 是否设置了私钥口令（密文永不回传） */
  passphraseConfigured: boolean;
}

export interface SshKeyCreatePayload {
  name: string;
  privateKey: string;
  passphrase?: string;
}

export interface SshKeyUpdatePayload {
  name?: string;
  privateKey?: string;
  passphrase?: string;
}

const BASE = "/api/ssh/keys";

export function listKeys(): Promise<SshKeyDTO[]> {
  return http.get<SshKeyDTO[]>(BASE);
}

/** 创建密钥，返回 keyId */
export function createKey(payload: SshKeyCreatePayload): Promise<string> {
  return http.post<string>(BASE, payload);
}

/** 更新密钥（留空字段不修改） */
export function updateKey(keyId: string, payload: SshKeyUpdatePayload): Promise<void> {
  return http.put<void>(`${BASE}/${keyId}`, payload);
}

/** 删除密钥（被连接引用时服务端返回错误） */
export function deleteKey(keyId: string): Promise<void> {
  return http.del<void>(`${BASE}/${keyId}`);
}
