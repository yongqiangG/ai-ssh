import { useState } from "react";
import type { MouseEvent } from "react";
import type { ToolCall } from "../types";
import { useTerminalStore } from "../stores/terminalStore";
import { useLayoutStore } from "../stores/layoutStore";
import { getTerminalSessionId, focusTerminal } from "../terminal/terminalManager";
import { sendTerminalCommand } from "../api/terminal";
import styles from "./CommandBlock.module.css";

/**
 * 命令块：等宽字体，命令行 + 可折叠输出 + 成败徽标（方案3 增强复制/重执行）。
 * 由 MessageBubble 在 AI 消息的 toolCalls 上逐个渲染。
 */
/** 危险命令前端检测（与后端 SshExecuteAdkTool 黑名单对齐），重执行前 confirm 二次确认 */
const DANGEROUS = [
  /\brm\s+(-[a-z]*r[a-z]*f|--force)\s+(\/|~|\*|\$HOME)\b/,
  /\bmkfs\b/,
  /\bdd\s+.*\bof=\/dev\//,
  /\b(shutdown|reboot|halt|poweroff|init\s+0)\b/,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/,
];
const isDangerous = (cmd: string) => DANGEROUS.some((re) => re.test(cmd));

export default function CommandBlock({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const activeConnId = useTerminalStore((s) => s.activeId);
  const setShowTerminal = useLayoutStore((s) => s.setShowTerminal);

  const status = call.status ?? "running";
  const ok = status === "success";
  const hasOutput = Boolean(call.output || call.analysis);
  // 活跃终端的 sessionId（无活跃连接或未开终端则为 null → 执行按钮禁用）
  const terminalSessionId = activeConnId ? getTerminalSessionId(activeConnId) : null;
  const canExecute = Boolean(terminalSessionId);

  const copy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(call.command ?? "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用（非 https / 无权限），静默 */
    }
  };

  const run = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!canExecute || !activeConnId || !terminalSessionId) return;
    if (
      isDangerous(call.command ?? "") &&
      !window.confirm(`危险命令，确认在终端执行？\n\n${call.command}`)
    ) {
      return;
    }
    try {
      await sendTerminalCommand(terminalSessionId, call.command ?? "");
      setShowTerminal(true); // 切到终端面板
      focusTerminal(activeConnId); // 聚焦终端
    } catch {
      /* 执行失败静默（终端仍可见） */
    }
  };

  return (
    <div className={styles.block}>
      <div className={styles.header} onClick={() => setOpen((v) => !v)}>
        <span className={styles.badge} data-ok={ok} data-running={status === "running"}>
          {status === "running" ? "执行中" : ok ? "成功" : "失败"}
        </span>
        <code className={styles.cmd}>{call.command}</code>
        <button
          className={styles.iconBtn}
          type="button"
          onClick={copy}
          title={copied ? "已复制" : "复制命令"}
        >
          {copied ? "✓" : "📋"}
        </button>
        <button
          className={styles.iconBtn}
          type="button"
          onClick={run}
          disabled={!canExecute}
          title={canExecute ? "在活跃终端执行" : "请先连接终端"}
        >
          ▶
        </button>
        {hasOutput && <span className={styles.toggle}>{open ? "▾" : "▸"}</span>}
      </div>
      {open && hasOutput && (
        <pre className={styles.output} onClick={(e) => e.stopPropagation()}>
          {call.output}
          {call.analysis && <span className={styles.analysis}>💡 {call.analysis}</span>}
        </pre>
      )}
    </div>
  );
}
