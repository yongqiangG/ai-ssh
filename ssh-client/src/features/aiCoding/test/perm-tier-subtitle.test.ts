import { describe, expect, it } from "vitest";
import { permTierSubtitle } from "../components/new-task/AgentPermSelector";
import type { PermAgentCatalog } from "../types";

// t 直接回显 key，断言不依赖具体译文
const t = (key: string) => key;

function catalog(overrides: Partial<PermAgentCatalog> = {}): PermAgentCatalog {
  return {
    agent: "codex",
    version: "0.144.6",
    tiers: [
      { key: "ask", args: ["-s", "read-only", "-a", "untrusted"], subtitleKey: "perm.subtitle.codex.ask", degraded: false },
      { key: "auto_edit", args: ["--sandbox", "workspace-write", "-a", "on-request"], subtitleKey: "perm.subtitle.codex.auto_edit", degraded: false },
      { key: "full_access", args: ["--dangerously-bypass-approvals-and-sandbox"], subtitleKey: "perm.subtitle.codex.full_access", degraded: false },
    ],
    effortStyle: "config",
    trustedProject: false,
    ...overrides,
  };
}

describe("permTierSubtitle 权限档位差异副标题", () => {
  it("按档位取适配层副标题 key", () => {
    expect(permTierSubtitle(catalog(), "codex", "auto_edit", t)).toBe("perm.subtitle.codex.auto_edit");
  });

  it("codex ask 在 trusted 项目下追加信任层警示", () => {
    const sub = permTierSubtitle(catalog({ trustedProject: true }), "codex", "ask", t);
    expect(sub).toContain("perm.subtitle.codex.ask");
    expect(sub).toContain("perm.subtitle.codex.trustedSuffix");
  });

  it("非 trusted 或非 codex 不追加信任警示", () => {
    expect(permTierSubtitle(catalog(), "codex", "ask", t)).toBe("perm.subtitle.codex.ask");
    expect(
      permTierSubtitle(catalog({ agent: "claude", trustedProject: true }), "claude", "ask", t),
    ).not.toContain("trustedSuffix");
  });

  it("目录缺失时副标题为空（不阻塞建任务）", () => {
    expect(permTierSubtitle(null, "codex", "ask", t)).toBe("");
  });
});
