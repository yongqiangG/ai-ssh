import { beforeEach, describe, expect, it } from "vitest";
import { useServersStore } from "./serversStore";
import type { ServerFormInput } from "./serversStore";

const input: ServerFormInput = {
  name: "web-1",
  host: "10.0.0.1",
  port: 22,
  username: "root",
  authMethod: "password",
  password: "pw",
};

beforeEach(() => {
  localStorage.clear();
  useServersStore.setState({ servers: [], selectedId: null });
});

describe("serversStore", () => {
  it("addServer 添加并自动选中新服务器", () => {
    const srv = useServersStore.getState().addServer(input);
    const state = useServersStore.getState();
    expect(state.servers).toHaveLength(1);
    expect(state.servers[0]).toMatchObject({
      name: "web-1",
      host: "10.0.0.1",
      port: 22,
    });
    expect(srv.id).toBeTruthy();
    expect(state.selectedId).toBe(srv.id);
  });

  it("updateServer 只更新匹配的服务器", () => {
    const srv = useServersStore.getState().addServer(input);
    useServersStore
      .getState()
      .updateServer(srv.id, { ...input, name: "web-2" });
    expect(useServersStore.getState().servers[0].name).toBe("web-2");
  });

  it("removeServer 删除并在选中项被删时清空选中", () => {
    const srv = useServersStore.getState().addServer(input);
    useServersStore.getState().removeServer(srv.id);
    expect(useServersStore.getState().servers).toHaveLength(0);
    expect(useServersStore.getState().selectedId).toBeNull();
  });

  it("removeServer 删除非选中项时保留当前选中", () => {
    const a = useServersStore.getState().addServer(input);
    useServersStore.getState().addServer({ ...input, name: "web-2" });
    useServersStore.getState().selectServer(a.id);
    const otherId = useServersStore
      .getState()
      .servers.find((s) => s.name === "web-2")!.id;
    useServersStore.getState().removeServer(otherId);
    expect(useServersStore.getState().selectedId).toBe(a.id);
  });

  it("持久化到 localStorage（仅数据，不含函数）", () => {
    useServersStore.getState().addServer(input);
    const raw = localStorage.getItem("ai-ssh:servers");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.servers).toHaveLength(1);
    expect(parsed.state.servers[0].name).toBe("web-1");
  });
});
