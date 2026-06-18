import { describe, expect, it, vi } from "vitest";
import type { SshServer } from "../types";
import { createMockSshService, mockCommandOutput } from "./mockSsh";

const server: SshServer = {
  id: "srv1",
  name: "t",
  host: "10.0.0.1",
  port: 22,
  username: "deploy",
  authMethod: "password",
  createdAt: 0,
};

describe("mockCommandOutput", () => {
  it("ls 返回目录列表", () => {
    expect(mockCommandOutput("ls", server)).toContain("home");
  });

  it("pwd 包含用户名", () => {
    expect(mockCommandOutput("pwd", server)).toBe("/home/deploy");
  });

  it("whoami 返回用户名", () => {
    expect(mockCommandOutput("whoami", server)).toBe("deploy");
  });

  it("echo 回显内容", () => {
    expect(mockCommandOutput("echo hello world", server)).toBe(
      "hello world"
    );
  });

  it("clear 与空命令返回空串", () => {
    expect(mockCommandOutput("clear", server)).toBe("");
    expect(mockCommandOutput("   ", server)).toBe("");
  });

  it("未知命令返回 not found 提示", () => {
    expect(mockCommandOutput("foobar", server)).toContain("command not found");
  });
});

describe("createMockSshService", () => {
  it("连接前 exec 抛错", async () => {
    const ssh = createMockSshService();
    await expect(ssh.exec("ls", () => {})).rejects.toThrow();
  });

  it("连接后通过 onData 回传输出", async () => {
    const ssh = createMockSshService();
    await ssh.connect(server);
    const onData = vi.fn();
    await ssh.exec("whoami", onData);
    expect(onData).toHaveBeenCalledWith("deploy");
  });

  it("断开后 exec 抛错", async () => {
    const ssh = createMockSshService();
    await ssh.connect(server);
    await ssh.disconnect();
    await expect(ssh.exec("ls", () => {})).rejects.toThrow();
  });

  it("空主机连接抛错", async () => {
    const ssh = createMockSshService();
    await expect(ssh.connect({ ...server, host: "" })).rejects.toThrow();
  });
});
