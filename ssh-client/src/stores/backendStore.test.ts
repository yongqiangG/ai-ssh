import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBackendStore } from "./backendStore";

const okBody = { code: "0000", info: "成功", data: "pong" };

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  useBackendStore.setState({
    baseUrl: "",
    testStatus: "idle",
    testMessage: null,
    readyStatus: "checking",
    readyMessage: null,
    bootPhase: "booting",
    bootInflight: false,
  });
});

describe("backendStore", () => {
  it("setBaseUrl 同步写 state 与 localStorage", () => {
    useBackendStore.getState().setBaseUrl("http://1.2.3.4:8091");
    expect(useBackendStore.getState().baseUrl).toBe("http://1.2.3.4:8091");
    expect(localStorage.getItem("ai-ssh:baseUrl")).toBe("http://1.2.3.4:8091");
  });

  it("waitForReady 在 ping 成功后标记 ready", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => okBody });
    vi.stubGlobal("fetch", fetchMock);
    useBackendStore.setState({ baseUrl: "http://host:8091" });

    await useBackendStore.getState().waitForReady(100, 1);

    expect(useBackendStore.getState().readyStatus).toBe("ready");
    expect(useBackendStore.getState().readyMessage).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("http://host:8091/api/ping", {
      headers: { "X-User-Id": "default" },
    });
  });

  it("setBaseUrl 会 trim；空串时移除 localStorage", () => {
    useBackendStore.getState().setBaseUrl("  http://x:8091  ");
    expect(useBackendStore.getState().baseUrl).toBe("http://x:8091");

    useBackendStore.getState().setBaseUrl("   ");
    expect(useBackendStore.getState().baseUrl).toBe("");
    expect(localStorage.getItem("ai-ssh:baseUrl")).toBeNull();
  });

  it("testConnection 成功：idle → testing → success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => okBody })
    );

    const promise = useBackendStore.getState().testConnection("http://ok:8091");
    // 调用后立即应处于 testing
    expect(useBackendStore.getState().testStatus).toBe("testing");

    await promise;
    expect(useBackendStore.getState().testStatus).toBe("success");
    expect(useBackendStore.getState().testMessage).toBeNull();
  });

  it("testConnection 命中 {baseUrl}/api/ping 且带 X-User-Id 头", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => okBody });
    vi.stubGlobal("fetch", fetchMock);

    await useBackendStore.getState().testConnection("http://host:8091");
    expect(fetchMock).toHaveBeenCalledWith("http://host:8091/api/ping", {
      headers: { "X-User-Id": "default" },
    });
  });

  it("testConnection 网络失败：→ fail 且 testMessage 非空", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network")));

    await useBackendStore.getState().testConnection("http://bad:8091");
    expect(useBackendStore.getState().testStatus).toBe("fail");
    expect(useBackendStore.getState().testMessage).toBeTruthy();
  });

  it("testConnection 后端返回非成功码：→ fail 且透传 info", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ code: "0001", info: "系统异常", data: null }),
      })
    );

    await useBackendStore.getState().testConnection("http://err:8091");
    expect(useBackendStore.getState().testStatus).toBe("fail");
    expect(useBackendStore.getState().testMessage).toBe("系统异常");
  });

  it("resetTest 清回 idle", () => {
    useBackendStore.setState({ testStatus: "fail", testMessage: "x" });
    useBackendStore.getState().resetTest();
    expect(useBackendStore.getState().testStatus).toBe("idle");
    expect(useBackendStore.getState().testMessage).toBeNull();
  });
});

describe("bootPhase 一次性启动门", () => {
  it("boot 成功：booting → done，readyStatus 同步 ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => okBody })
    );

    await useBackendStore.getState().boot(100, 1, 0);

    expect(useBackendStore.getState().bootPhase).toBe("done");
    expect(useBackendStore.getState().readyStatus).toBe("ready");
  });

  it("boot 成功后记录启动耗时供下次进度预估", async () => {
    // ping 至少耗 2ms，否则 0ms 会被 saveBootDuration 的无效值防护丢弃
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 2));
        return { json: async () => okBody };
      })
    );

    await useBackendStore.getState().boot(100, 1, 0);

    expect(localStorage.getItem("ai-ssh:lastBootMs")).toBeTruthy();
  });

  it("就绪后先进入冲刺窗口（ready+booting 组合态）再 done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => okBody })
    );

    const finished = useBackendStore.getState().boot(100, 1, 60);
    await vi.waitFor(() => {
      const s = useBackendStore.getState();
      expect(s.readyStatus).toBe("ready");
      expect(s.bootPhase).toBe("booting");
    });

    await finished;
    expect(useBackendStore.getState().bootPhase).toBe("done");
  });

  it("boot 失败（超时）：→ failed 且 readyMessage 非空", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await useBackendStore.getState().boot(30, 1, 0);

    expect(useBackendStore.getState().bootPhase).toBe("failed");
    expect(useBackendStore.getState().readyMessage).toBeTruthy();
  });

  it("failed 后重试成功 → done", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await useBackendStore.getState().boot(30, 1, 0);
    expect(useBackendStore.getState().bootPhase).toBe("failed");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => okBody })
    );
    await useBackendStore.getState().boot(100, 1, 0);
    expect(useBackendStore.getState().bootPhase).toBe("done");
  });

  it("done 后 setBaseUrl 不回退 bootPhase（改地址不再全屏遮罩）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => okBody })
    );
    await useBackendStore.getState().boot(100, 1, 0);

    useBackendStore.getState().setBaseUrl("http://other:8091");

    expect(useBackendStore.getState().bootPhase).toBe("done");
  });

  it("booting 进行中重复调 boot 不重复发起轮询（StrictMode 双调防护）", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => okBody });
    vi.stubGlobal("fetch", fetchMock);

    const first = useBackendStore.getState().boot(100, 1, 0);
    const second = useBackendStore.getState().boot(100, 1, 0);
    await Promise.all([first, second]);

    expect(useBackendStore.getState().bootPhase).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("done 后再调 boot 是 no-op", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => okBody });
    vi.stubGlobal("fetch", fetchMock);
    await useBackendStore.getState().boot(100, 1, 0);
    fetchMock.mockClear();

    await useBackendStore.getState().boot(100, 1, 0);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
