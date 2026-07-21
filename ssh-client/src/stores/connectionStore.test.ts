import { beforeEach, describe, expect, it, vi } from "vitest";

// 仅 mock 网络函数，保留 toConnection 真实实现以覆盖状态映射
vi.mock("../api/sshConnection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../api/sshConnection")>();
  return {
    ...actual,
    listConnections: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    connectConnection: vi.fn(),
    disconnectConnection: vi.fn(),
  };
});

import {
  connectConnection,
  deleteConnection,
  disconnectConnection,
  listConnections,
} from "../api/sshConnection";
import type { SshConnectionDTO } from "../api/sshConnection";
import { useConnectionStore } from "./connectionStore";

const dto = (over: Partial<SshConnectionDTO> = {}): SshConnectionDTO => ({
  connectionId: "c1",
  name: "web-1",
  host: "10.0.0.1",
  port: 22,
  username: "root",
  authType: "PASSWORD",
  passwordConfigured: true,
  status: 0,
  userId: "default",
  connectTimeout: 5000,
  keepaliveInterval: 30000,
  startupCommand: "",
  knownHosts: "",
  strictHostKeyCheck: false,
  compression: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useConnectionStore.setState({ connections: [], loading: false, error: null });
});

describe("connectionStore", () => {
  it("fetchList 映射服务端状态编码（0/1 → disconnected/connected）", async () => {
    (listConnections as ReturnType<typeof vi.fn>).mockResolvedValue([
      dto({ connectionId: "c1", status: 0 }),
      dto({ connectionId: "c2", status: 1 }),
    ]);
    await useConnectionStore.getState().fetchList();
    const list = useConnectionStore.getState().connections;
    expect(list.map((c) => c.status)).toEqual(["disconnected", "connected"]);
  });

  it("connect 成功：disconnected → connecting → connected", async () => {
    useConnectionStore.setState({
      connections: [{ ...dto(), status: "disconnected" as const }],
    });
    (connectConnection as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    });

    const promise = useConnectionStore.getState().connect("c1");
    // 调用后立即应处于 connecting（乐观更新）
    expect(
      useConnectionStore.getState().connections[0].status
    ).toBe("connecting");

    await promise;
    expect(useConnectionStore.getState().connections[0].status).toBe(
      "connected"
    );
  });

  it("connect 服务端返回失败 → error", async () => {
    useConnectionStore.setState({
      connections: [{ ...dto(), status: "disconnected" as const }],
    });
    (connectConnection as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "认证失败",
    });

    await useConnectionStore.getState().connect("c1");
    expect(useConnectionStore.getState().connections[0].status).toBe("error");
  });

  it("connect 被 TOFU 拦截 → pendingHostKey 置位且状态回 disconnected", async () => {
    useConnectionStore.setState({
      connections: [{ ...dto(), status: "disconnected" as const }],
      pendingHostKey: null,
    });
    (connectConnection as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      hostKeyStatus: "UNKNOWN",
      host: "10.0.0.1",
      fingerprintSha256: "SHA256:abc",
      knownHostLine: "10.0.0.1 ssh-ed25519 AAAA",
    });

    await useConnectionStore.getState().connect("c1");
    const s = useConnectionStore.getState();
    expect(s.connections[0].status).toBe("disconnected");
    expect(s.pendingHostKey?.connectionId).toBe("c1");
    expect(s.pendingHostKey?.result.hostKeyStatus).toBe("UNKNOWN");
  });

  it("connect 抛异常 → error", async () => {
    useConnectionStore.setState({
      connections: [{ ...dto(), status: "disconnected" as const }],
    });
    (connectConnection as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("认证失败")
    );

    await expect(useConnectionStore.getState().connect("c1")).rejects.toThrow(
      "认证失败"
    );
    expect(useConnectionStore.getState().connections[0].status).toBe("error");
  });

  it("disconnect 成功 → disconnected", async () => {
    useConnectionStore.setState({
      connections: [{ ...dto(), status: "connected" as const }],
    });
    (disconnectConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined
    );

    await useConnectionStore.getState().disconnect("c1");
    expect(useConnectionStore.getState().connections[0].status).toBe(
      "disconnected"
    );
  });

  it("remove 从列表移除对应连接", async () => {
    useConnectionStore.setState({
      connections: [
        { ...dto(), status: "disconnected" as const },
        { ...dto({ connectionId: "c2" }), status: "disconnected" as const },
      ],
    });
    (deleteConnection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await useConnectionStore.getState().remove("c1");
    expect(
      useConnectionStore.getState().connections.map((c) => c.connectionId)
    ).toEqual(["c2"]);
  });
});
