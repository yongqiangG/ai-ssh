import { useState } from "react";
import type { MouseEvent } from "react";
import type { ToolCall } from "../types";
import { useTerminalStore } from "../stores/terminalStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useChatStore } from "../stores/chatStore";
import { getTerminalSessionId, focusTerminal } from "../terminal/terminalManager";
import { sendTerminalCommand } from "../api/terminal";
import Icon from "./Icon";
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
  const setCenterView = useLayoutStore((s) => s.setCenterView);

  const status = call.status ?? "running";
  const ok = status === "success";
  const pendingConfirm = status === "pending_confirm";
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

  /** 命令「飞向终端」联动动效：克隆命令文本从执行按钮飞向中间工作区，落点闪光 */
  const flyToTerminal = (fromEl: HTMLElement) => {
    const from = fromEl.getBoundingClientRect();
    const target = document.getElementById("work-center");
    const to = target?.getBoundingClientRect() ?? {
      left: window.innerWidth / 2,
      top: window.innerHeight / 2,
      width: 0,
      height: 0,
    };
    const clone = document.createElement("div");
    clone.textContent = "▶ " + (call.command ?? "");
    clone.style.cssText =
      "position:fixed;z-index:9999;pointer-events:none;left:" +
      from.left +
      "px;top:" +
      from.top +
      "px;max-width:300px;padding:5px 11px;border-radius:6px;background:var(--vsc-accent);color:var(--vsc-accent-fg);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform:scale(1.1);box-shadow:0 6px 20px rgba(0,0,0,0.6),0 0 18px var(--accent-glow)";
    document.body.appendChild(clone);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    requestAnimationFrame(() => {
      clone.style.transition =
        "transform .7s cubic-bezier(.45,-.1,.6,1),opacity .7s ease-in";
      clone.style.transform =
        "translate(" + dx + "px," + dy + "px) scale(.5) rotate(18deg)";
      clone.style.opacity = "0";
    });
    // 落点闪光：work-center accent 内描边 + 内发光，0.55s 还原
    if (target) {
      const prevShadow = target.style.boxShadow;
      const prevTransition = target.style.transition;
      target.style.transition = "box-shadow .25s ease-out";
      target.style.boxShadow =
        "inset 0 0 0 2px var(--vsc-accent), inset 0 0 40px var(--accent-glow)";
      window.setTimeout(() => {
        target.style.boxShadow = prevShadow;
        target.style.transition = prevTransition;
      }, 550);
    }
    window.setTimeout(() => clone.remove(), 750);
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
    flyToTerminal(e.currentTarget as HTMLElement);
    try {
      await sendTerminalCommand(terminalSessionId, call.command ?? "");
      setShowTerminal(true); // 切到终端面板
      setCenterView("terminal"); // 从 SFTP 视图切回终端
      focusTerminal(activeConnId); // 聚焦终端
    } catch {
      /* 执行失败静默（终端仍可见） */
    }
  };

  return (
    <div className={`${styles.block} ${pendingConfirm ? styles.confirmBlock : ""}`}>
      <div className={styles.header} onClick={() => setOpen((v) => !v)}>
        <span
          className={styles.badge}
          data-ok={ok}
          data-running={status === "running"}
          data-confirm={pendingConfirm}
        >
          {pendingConfirm
            ? "待确认"
            : status === "running"
              ? "执行中"
              : ok
                ? "成功"
                : "失败"}
        </span>
        <code className={styles.cmd}>{call.command}</code>
        <button
          className={`${styles.iconBtn} ${styles.copyBtn}`}
          type="button"
          onClick={copy}
          title={copied ? "已复制" : "复制命令"}
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>
        <button
          className={`${styles.iconBtn} ${styles.runBtn}`}
          type="button"
          onClick={run}
          disabled={!canExecute}
          title={canExecute ? "在活跃终端执行" : "请先连接终端"}
        >
          <Icon name="play" size={12} />
        </button>
        {hasOutput && <span className={styles.toggle}>{open ? "▾" : "▸"}</span>}
      </div>
      {pendingConfirm && (
        <div className={styles.confirmBar} onClick={(e) => e.stopPropagation()}>
          <span className={styles.confirmReason}>
            ⚠️ 写操作需要你的确认{call.analysis ? `（${call.analysis}）` : ""}
          </span>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.denyBtn}
              onClick={() =>
                call.confirmId &&
                useChatStore.getState().decideConfirm(call.confirmId, false)
              }
            >
              拒绝
            </button>
            <button
              type="button"
              className={styles.allowBtn}
              onClick={() =>
                call.confirmId &&
                useChatStore.getState().decideConfirm(call.confirmId, true)
              }
            >
              允许执行
            </button>
          </div>
        </div>
      )}
      {open && hasOutput && !pendingConfirm && (
        <pre className={styles.output} onClick={(e) => e.stopPropagation()}>
          {call.output}
          {call.analysis && <span className={styles.analysis}>💡 {call.analysis}</span>}
        </pre>
      )}
    </div>
  );
}
