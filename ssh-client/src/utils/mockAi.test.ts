import { describe, expect, it } from "vitest";
import { PRESET_AGENTS, mockReply } from "./mockAi";

describe("PRESET_AGENTS", () => {
  it("包含至少三个预设智能体且 id 唯一", () => {
    expect(PRESET_AGENTS.length).toBeGreaterThanOrEqual(3);
    const ids = PRESET_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个智能体有 id 与 name", () => {
    for (const a of PRESET_AGENTS) {
      expect(a.id).toBeTruthy();
      expect(a.name).toBeTruthy();
    }
  });
});

describe("mockReply", () => {
  it("ops 智能体回复包含运维排查关键词", () => {
    const r = mockReply("nginx 起不来", "ops");
    expect(r).toContain("运维专家");
    expect(r).toContain("systemctl");
  });

  it("coder 智能体回复包含代码块标记", () => {
    const r = mockReply("写个函数", "coder");
    expect(r).toContain("代码助手");
    expect(r).toContain("```");
  });

  it("默认（general）智能体回复回显用户输入", () => {
    const r = mockReply("你好", "general");
    expect(r).toContain("通用助手");
    expect(r).toContain("你好");
  });

  it("未知 agentId 回退到通用回复", () => {
    const r = mockReply("测试", "unknown-agent");
    expect(r).toContain("通用助手");
  });
});
