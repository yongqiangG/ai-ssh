import { create } from "zustand";
import type { ConnectionState, SshServer } from "../types";
import { createId } from "../utils/id";
import { createMockSshService } from "../utils/mockSsh";

export type LineKind = "stdout" | "stderr" | "system" | "input";

export interface TerminalLine {
  id: string;
  text: string;
  kind: LineKind;
}

interface TerminalState {
  connection: ConnectionState;
  connectedServer: SshServer | null;
  lines: TerminalLine[];
  error: string | null;

  connect: (server: SshServer) => Promise<void>;
  disconnect: () => Promise<void>;
  exec: (command: string) => Promise<void>;
  clear: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const prompt = (server: SshServer | null) =>
  `${server?.username ?? "user"}@${server?.host ?? "localhost"}:~$ `;

const line = (text: string, kind: LineKind): TerminalLine => ({
  id: createId("ln"),
  text,
  kind,
});

export const useTerminalStore = create<TerminalState>((set, get) => {
  const ssh = createMockSshService();

  return {
    connection: "disconnected",
    connectedServer: null,
    lines: [],
    error: null,

    connect: async (server) => {
      const { connection } = get();
      if (connection === "connected" || connection === "connecting") return;
      set({
        connection: "connecting",
        error: null,
        lines: [],
        connectedServer: server,
      });
      try {
        await ssh.connect(server);
        set((s) => ({
          connection: "connected",
          lines: [
            ...s.lines,
            line(`Connecting to ${server.host}:${server.port} ... 已连接（mock）`, "system"),
            line(
              `Welcome to AI-SSH mock shell · 输入 help 查看可用命令`,
              "system"
            ),
          ],
        }));
      } catch (e) {
        set({
          connection: "error",
          error: errMsg(e),
          connectedServer: null,
          lines: [line(`连接失败：${errMsg(e)}`, "stderr")],
        });
      }
    },

    disconnect: async () => {
      const wasConnected = get().connection === "connected";
      await ssh.disconnect();
      set((s) => ({
        connection: "disconnected",
        connectedServer: null,
        lines: wasConnected
          ? [...s.lines, line("连接已断开", "system")]
          : s.lines,
      }));
    },

    exec: async (command) => {
      const st = get();
      if (st.connection !== "connected" || !st.connectedServer) return;

      if (command.trim() === "clear") {
        set({ lines: [] });
        return;
      }

      set((s) => ({
        lines: [...s.lines, line(`${prompt(st.connectedServer)}${command}`, "input")],
      }));

      try {
        await ssh.exec(command, (data) => {
          if (!data) return;
          set((s) => ({ lines: [...s.lines, line(data, "stdout")] }));
        });
      } catch (e) {
        set((s) => ({ lines: [...s.lines, line(errMsg(e), "stderr")] }));
      }
    },

    clear: () => set({ lines: [] }),
  };
});
