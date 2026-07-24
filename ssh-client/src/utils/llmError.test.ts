import { describe, expect, it } from "vitest";
import { humanizeClientError, isRetryableLlmError } from "./llmError";

describe("isRetryableLlmError", () => {
  it("连接断/超时/限流/5xx/未知/无 code 可重试", () => {
    for (const code of [
      "LLM_CONNECTION_LOST",
      "LLM_TIMEOUT",
      "LLM_RATE_LIMITED",
      "LLM_SERVER_ERROR",
      "LLM_UNKNOWN",
      undefined,
    ]) {
      expect(isRetryableLlmError(code)).toBe(true);
    }
  });

  it("认证/配置错误与会话失效不可重试", () => {
    for (const code of ["LLM_AUTH_FAILED", "LLM_BAD_CONFIG", "AI_SESSION_EXPIRED"]) {
      expect(isRetryableLlmError(code)).toBe(false);
    }
  });
});

describe("humanizeClientError", () => {
  it("浏览器 fetch 失败翻译为人话", () => {
    expect(humanizeClientError("Failed to fetch")).toContain("后端服务");
  });

  it("HTTP 5xx 翻译为人话", () => {
    expect(humanizeClientError("HTTP 502: Bad Gateway")).toContain("稍后重试");
  });

  it("未识别的错误原样透传", () => {
    expect(humanizeClientError("某个具体的业务错误")).toBe("某个具体的业务错误");
  });
});
