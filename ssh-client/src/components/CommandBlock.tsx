import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { ToolCall } from "../types";
import { useTerminalStore } from "../stores/terminalStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useChatStore } from "../stores/chatStore";
import { getTerminalSessionId, focusTerminal } from "../terminal/terminalManager";
import { sendTerminalCommand } from "../api/terminal";
import { flyCommandToTerminal } from "../utils/flyToTerminal";
import ConfirmDialog from "./ConfirmDialog";
import Icon from "./Icon";
import styles from "./CommandBlock.module.css";

/**
 * 命令块：等宽字体，命令行 + 可折叠输出 + 成败徽标（方案3 增强复制/重执行）。
 * 由 MessageBubble 在 AI 消息的 toolCalls 上逐个渲染。
 */
/**
 * 危险命令前端检测：与后端 SshExecuteAdkTool.BLOCKED 八条一一对应（语义照抄，勿单边增删），
 * 用于「重执行按钮」前的 confirm 二次确认。
 */
const DANGEROUS = [
  // rm 递归强删根/家目录（兼容 -rf 与 -fr 两种字母顺序，以及 --force）
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--force)[a-z-]*\s+(\/|~|\*|\$HOME)/,
  /\bmkfs\b/,
  /\bdd\s+.*\bof=\/dev\//,
  /\b(shutdown|reboot|halt|poweroff|init\s+0)\b/,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, // fork 炸弹
  /\b>(\s*)\/dev\/sd[a-z]/,
  /\bchmod\s+-R\s+000\s+\//,
  /\b>(\s*)\/dev\/null\s+<\s*\/dev\//,
];
const isDangerous = (cmd: string) => DANGEROUS.some((re) => re.test(cmd));

export default function CommandBlock({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  /** 危险命令重执行的应用内二次确认（替代 window.confirm，主题统一） */
  const [dangerOpen, setDangerOpen] = useState(false);
  /** 拒绝动效进行中：confirmBar 收缩 + 卡片红脉冲，播完才真正 decideConfirm */
  const [denying, setDenying] = useState(false);
  const runBtnRef = useRef<HTMLButtonElement>(null);
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

  /** 真正执行（直接触发，或危险命令经应用内确认后触发） */
  const doRun = async (fromEl: HTMLElement | null) => {
    if (!canExecute || !activeConnId || !terminalSessionId) return;
    if (fromEl) flyCommandToTerminal(fromEl, call.command ?? "");
    try {
      await sendTerminalCommand(terminalSessionId, call.command ?? "");
      setShowTerminal(true); // 切到终端面板
      setCenterView("terminal"); // 从 SFTP 视图切回终端
      focusTerminal(activeConnId); // 聚焦终端
    } catch {
      /* 执行失败静默（终端仍可见） */
    }
  };

  const run = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canExecute) return;
    if (isDangerous(call.command ?? "")) {
      setDangerOpen(true);
      return;
    }
    void doRun(e.currentTarget as HTMLElement);
  };

  /** 确认门放行：命令飞向终端 + 唤醒后端 ConfirmGate + 注意力跟随命令切到终端 */
  const allow = (e: MouseEvent) => {
    if (!call.confirmId) return;
    flyCommandToTerminal(e.currentTarget as HTMLElement, call.command ?? "");
    void useChatStore.getState().decideConfirm(call.confirmId, true);
    setShowTerminal(true);
    setCenterView("terminal");
    if (activeConnId) focusTerminal(activeConnId);
  };

  /** 确认门拒绝：命令没有去处不飞，原地「熄火」（收缩 + 红脉冲）后再通知后端 */
  const deny = () => {
    if (!call.confirmId || denying) return;
    const confirmId = call.confirmId;
    setDenying(true);
    window.setTimeout(() => {
      void useChatStore.getState().decideConfirm(confirmId, false);
    }, 220);
  };

  return (
    <div
      className={`${styles.block} ${pendingConfirm ? styles.confirmBlock : ""} ${
        denying ? styles.denyPulse : ""
      }`}
    >
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
          ref={runBtnRef}
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
        <div
          className={`${styles.confirmBar} ${denying ? styles.denyCollapse : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className={styles.confirmReason}>
            ⚠️ 写操作需要你的确认{call.analysis ? `（${call.analysis}）` : ""}
          </span>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.denyBtn}
              onClick={deny}
              disabled={denying}
            >
              拒绝
            </button>
            <button
              type="button"
              className={styles.allowBtn}
              onClick={allow}
              disabled={denying}
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
      {dangerOpen && (
        <ConfirmDialog
          message={`危险命令，确认在终端执行？\n\n${call.command ?? ""}`}
          confirmText="仍要执行"
          cancelText="取消"
          onResolve={(ok) => {
            setDangerOpen(false);
            if (ok) void doRun(runBtnRef.current);
          }}
        />
      )}
    </div>
  );
}
