import { create } from "zustand";
import type { SshConnection, SshConnectionPayload } from "../api/sshConnection";
import {
  connectConnection,
  createConnection,
  deleteConnection,
  disconnectConnection,
  listConnections,
  toConnection,
  updateConnection,
} from "../api/sshConnection";

interface ConnectionState_ {
  connections: SshConnection[];
  loading: boolean;
  error: string | null;

  fetchList: () => Promise<void>;
  create: (payload: SshConnectionPayload) => Promise<void>;
  update: (id: string, payload: Partial<SshConnectionPayload>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 建立连接：disconnected → connecting → connected/error */
  connect: (id: string) => Promise<void>;
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
      const ok = await connectConnection(id);
      set((s) => ({
        connections: patchStatus(
          s.connections,
          id,
          ok ? "connected" : "error"
        ),
      }));
    } catch (e) {
      set((s) => ({ connections: patchStatus(s.connections, id, "error") }));
      throw e;
    }
  },

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
