import { describe, expect, it } from "vitest";
import { classifyLlmConfigChange } from "./llmConfigChange";

const current = {
  providerName: "OpenAI Compatible",
  baseUrl: "https://example.com",
  model: "model-a",
  completionsPath: "/v1/chat/completions",
  apiKeyConfigured: true,
};

describe("classifyLlmConfigChange", () => {
  it("未修改且 API Key 留空时是 no_change", () => {
    expect(classifyLlmConfigChange(current, { ...current, apiKey: "" })).toBe(
      "no_change"
    );
  });

  it("只修改服务商显示名时只需保存，不重建 Runner", () => {
    expect(
      classifyLlmConfigChange(current, {
        ...current,
        providerName: "内部网关",
        apiKey: "",
      })
    ).toBe("metadata_only");
  });

  it("模型端点字段或新 API Key 变化时需要重建 Runner", () => {
    expect(
      classifyLlmConfigChange(current, { ...current, model: "model-b", apiKey: "" })
    ).toBe("runner_reload");
    expect(
      classifyLlmConfigChange(current, { ...current, apiKey: "new-key" })
    ).toBe("runner_reload");
  });
});
