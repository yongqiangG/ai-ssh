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
  });
});

describe("backendStore", () => {
  it("setBaseUrl 同步写 state 与 localStorage", () => {
    useBackendStore.getState().setBaseUrl("http://1.2.3.4:8091");
    expect(useBackendStore.getState().baseUrl).toBe("http://1.2.3.4:8091");
    expect(localStorage.getItem("ai-ssh:baseUrl")).toBe("http://1.2.3.4:8091");
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
