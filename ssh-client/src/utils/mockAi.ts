import type { Agent, AiService } from "../types";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 预设智能体列表（将来从后端获取） */
export const PRESET_AGENTS: Agent[] = [
  { id: "general", name: "通用助手", description: "通用问答与日常建议" },
  { id: "ops", name: "运维专家", description: "聚焦 Linux / SSH 运维排障" },
  { id: "coder", name: "代码助手", description: "代码生成、解释与重构" },
];

/**
 * 生成智能体的 mock 回复（纯函数，便于单元测试）。
 * 真实回复将来由后端 AI 服务提供。
 */
export function mockReply(text: string, agentId: string): string {
  const t = text.trim();

  if (agentId === "ops") {
    return [
      `【运维专家】关于「${t}」，建议按顺序排查：`,
      "  1. systemctl status <服务>  查看服务状态",
      "  2. journalctl -xe           查看日志",
      "  3. df -h / free -m          检查磁盘与内存",
      "  4. ss -tlnp                 检查端口监听",
      "（mock 回复，真实 AI 调用由后端提供）",
    ].join("\n");
  }

  if (agentId === "coder") {
    return [
      `【代码助手】关于「${t}」，参考思路：`,
      "```",
      "// 示例占位代码",
      "function solve(input: string) {",
      "  return input.trim();",
      "}",
      "```",
      "（mock 回复，真实模型由后端提供）",
    ].join("\n");
  }

  return [
    `【通用助手】你提到：「${t}」。`,
    "这是一条 mock 回复——真实 AI 调用将由后端项目提供。",
  ].join("\n");
}

/** 创建一个 mock 的 AiService。将来替换为后端实现。 */
export function createMockAiService(): AiService {
  return {
    agents: PRESET_AGENTS,
    async sendMessage(text, agentId) {
      await delay(450);
      return mockReply(text, agentId);
    },
  };
}
