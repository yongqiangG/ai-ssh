import type { SshServer, SshService } from "../types";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 生成命令的 mock 输出（纯函数，便于单元测试）。
 * 真实输出将来由后端 SSH 服务提供。
 */
export function mockCommandOutput(command: string, server: SshServer | null): string {
  const cmd = command.trim();
  if (cmd === "") return "";
  if (cmd === "clear") return "";

  if (cmd === "ls" || cmd === "ls -la" || cmd.startsWith("ls ")) {
    return "bin   boot  dev  etc   home  lib   lib64  opt  proc  root  run  sbin  srv  tmp  usr  var";
  }
  if (cmd === "pwd") return `/home/${server?.username ?? "user"}`;
  if (cmd === "whoami") return server?.username ?? "root";
  if (cmd === "hostname") return server?.host ? `${server.host.split(".")[0]}-mock` : "mock-host";
  if (cmd === "date") return new Date().toString();
  if (cmd === "uname -a") return "Linux mock-host 6.1.0-mock #1 SMP x86_64 GNU/Linux";
  if (cmd.startsWith("echo ")) return cmd.slice(5);
  if (cmd === "help") {
    return [
      "可用命令（mock 环境）：",
      "  ls / pwd / whoami / hostname / date / uname -a / echo <text> / clear",
    ].join("\n");
  }
  const first = cmd.split(/\s+/)[0];
  return `bash: ${first}: command not found（mock 环境，输入 help 查看可用命令）`;
}

/**
 * 创建一个 mock 的 SshService。将来替换为基于后端 HTTP/WebSocket 的真实实现。
 */
export function createMockSshService(): SshService {
  let connected = false;
  let current: SshServer | null = null;

  return {
    async connect(config) {
      await delay(350);
      if (!config.host) throw new Error("主机地址为空，无法连接");
      connected = true;
      current = config;
    },

    async exec(command, onData) {
      if (!connected) throw new Error("尚未建立 SSH 连接");
      await delay(120);
      onData(mockCommandOutput(command, current));
    },

    async disconnect() {
      await delay(80);
      connected = false;
      current = null;
    },
  };
}
