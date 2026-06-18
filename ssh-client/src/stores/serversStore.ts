import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthMethod, SshServer } from "../types";
import { createId } from "../utils/id";

/** 新增/编辑服务器时的输入（不含 id / createdAt） */
export interface ServerFormInput {
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  privateKey?: string;
  group?: string;
}

interface ServersState {
  servers: SshServer[];
  /** 当前选中的服务器 id（用于中栏连接） */
  selectedId: string | null;

  addServer: (input: ServerFormInput) => SshServer;
  updateServer: (id: string, input: ServerFormInput) => void;
  removeServer: (id: string) => void;
  selectServer: (id: string | null) => void;
}

export const useServersStore = create<ServersState>()(
  persist(
    (set) => ({
      servers: [],
      selectedId: null,

      addServer: (input) => {
        const server: SshServer = {
          ...input,
          id: createId("srv"),
          createdAt: Date.now(),
        };
        set((s) => ({
          servers: [...s.servers, server],
          selectedId: server.id,
        }));
        return server;
      },

      updateServer: (id, input) =>
        set((s) => ({
          servers: s.servers.map((srv) =>
            srv.id === id ? { ...srv, ...input } : srv
          ),
        })),

      removeServer: (id) =>
        set((s) => ({
          servers: s.servers.filter((srv) => srv.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),

      selectServer: (id) => set({ selectedId: id }),
    }),
    {
      name: "ai-ssh:servers",
      // 只持久化数据，不持久化 action 函数
      partialize: (s) => ({
        servers: s.servers,
        selectedId: s.selectedId,
      }),
    }
  )
);
