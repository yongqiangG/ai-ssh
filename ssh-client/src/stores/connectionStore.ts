import { create } from "zustand";
import type {
  ConnectResultDTO,
  SshConnection,
  SshConnectionPayload,
} from "../api/sshConnection";
import {
  acceptHostKey,
  connectConnection,
  createConnection,
  deleteConnection,
  disconnectConnection,
  listConnections,
  toConnection,
  updateConnection,
} from "../api/sshConnection";

/** 待用户确认的主机指纹（TOFU 拦截现场） */
export interface PendingHostKey {
  connectionId: string;
  result: ConnectResultDTO;
}

interface ConnectionState_ {
  connections: SshConnection[];
  loading: boolean;
  error: string | null;
  /** 非空时渲染指纹确认弹窗（UNKNOWN 确认卡 / CHANGED 红色警告） */
  pendingHostKey: PendingHostKey | null;

  fetchList: () => Promise<void>;
  create: (payload: SshConnectionPayload) => Promise<void>;
  update: (id: string, payload: Partial<SshConnectionPayload>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 建立连接：disconnected → connecting → connected/error；TOFU 拦截时置 pendingHostKey 等确认 */
  connect: (id: string) => Promise<void>;
  /** 用户确认指纹：写入 knownHosts 后自动重连 */
  acceptPendingHostKey: () => Promise<void>;
  /** 用户拒绝指纹：清弹窗，连接保持断开 */
  rejectPendingHostKey: () => void;
  /** 断开连接 → disconnected */
  disconnect: (id: string) => Promise<void>;
  /** 本地标记连接失效（终端断连/心跳失败时调用，不发请求） */
  markError: (id: string) => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 局部更新某条连接的状态 */
function patchStatus(
  list: SshConnection[],
  id: string,
  status: SshConnection["status"]
): SshConnection[] {
  return list.map((c) => (c.connectionId === id ? { ...c, status } : c));
}

export const useConnectionStore = create<ConnectionState_>((set, get) => ({
  connections: [],
  loading: false,
  error: null,
  pendingHostKey: null,

  fetchList: async () => {
    set({ loading: true, error: null });
    try {
      const dtos = await listConnections();
      set({ connections: dtos.map(toConnection), loading: false });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
      throw e;
    }
  },

  create: async (payload) => {
    await createConnection(payload);
    await get().fetchList();
  },

  update: async (id, payload) => {
    await updateConnection(id, payload);
    await get().fetchList();
  },

  remove: async (id) => {
    await deleteConnection(id);
    set((s) => ({
      connections: s.connections.filter((c) => c.connectionId !== id),
    }));
  },

  connect: async (id) => {
    // 乐观置为 connecting，避免点击后无反馈
    set((s) => ({ connections: patchStatus(s.connections, id, "connecting") }));
    try {
      const result = await connectConnection(id);
      if (result.success) {
        set((s) => ({
          connections: patchStatus(s.connections, id, "connected"),
        }));
        return;
      }
      if (result.hostKeyStatus) {
        // TOFU 拦截：不算失败，弹指纹确认，连接暂回 disconnected 等用户决定
        set((s) => ({
          connections: patchStatus(s.connections, id, "disconnected"),
          pendingHostKey: { connectionId: id, result },
        }));
        return;
      }
      set((s) => ({
        connections: patchStatus(s.connections, id, "error"),
        error: result.error ?? "连接失败",
      }));
    } catch (e) {
      set((s) => ({ connections: patchStatus(s.connections, id, "error") }));
      throw e;
    }
  },

  acceptPendingHostKey: async () => {
    const pending = get().pendingHostKey;
    if (!pending?.result.knownHostLine) return;
    await acceptHostKey(pending.connectionId, pending.result.knownHostLine);
    set({ pendingHostKey: null });
    // 指纹已入 knownHosts，重连走正常校验路径
    await get().connect(pending.connectionId);
  },

  rejectPendingHostKey: () => set({ pendingHostKey: null }),

  disconnect: async (id) => {
    try {
      await disconnectConnection(id);
      set((s) => ({
        connections: patchStatus(s.connections, id, "disconnected"),
      }));
    } catch (e) {
      // 断开失败：与服务端对齐，刷新一次状态
      await get().fetchList();
      throw e;
    }
  },

  markError: (id) =>
    set((s) => ({ connections: patchStatus(s.connections, id, "error") })),
}));
