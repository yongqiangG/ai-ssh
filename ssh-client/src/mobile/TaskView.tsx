import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { themeFor } from "../features/aiCoding/components/terminalShared";
import type { ThemeVariant } from "../features/aiCoding/types";
import { getToken, type Task } from "./api";
import { TaskWs, type WsConnState } from "./ws";

const ATTENTION_STATUSES = new Set(["input_required", "awaiting_review"]);

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  running: { text: "运行中", cls: "st-running" },
  input_required: { text: "待确认", cls: "st-attention" },
  awaiting_review: { text: "待验收", cls: "st-attention" },
  done: { text: "完成", cls: "st-done" },
  failed: { text: "失败", cls: "st-failed" },
  cancelled: { text: "已取消", cls: "st-muted" },
};

const CONN_LABEL: Record<WsConnState, { text: string; cls: string }> = {
  connecting: { text: "连接中", cls: "conn-mid" },
  open: { text: "已连接", cls: "conn-ok" },
  backoff: { text: "重连中", cls: "conn-mid" },
  closed: { text: "已断开", cls: "conn-off" },
};

function wsUrl(taskId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/ws/task/${encodeURIComponent(taskId)}?token=${encodeURIComponent(getToken())}`;
}

export function TaskView({ task, onBack }: { task: Task; onBack: () => void }) {
  const termHostRef = useRef<HTMLDivElement | null>(null);
  // 滚动按钮触达闭包内的 term 实例（按钮渲染在 effect 外）
  const termApiRef = useRef<{
    scroll: (lines: number) => void;
    toTop: () => void;
    toBottom: () => void;
  } | null>(null);
  const [status, setStatus] = useState(task.status);
  const [conn, setConn] = useState<WsConnState>("connecting");

  useEffect(() => {
    const host = termHostRef.current;
    if (!host) return;
    // 手机固定逻辑尺寸、不 resize（Q10 决议：避免与桌面端打架）。宽流（桌面
    // 220 列）按窄屏折行渲染——已知取舍：全屏 TUI 画面观感粗糙，但批准类
    // 单行文本可读，交互闭环不受影响。
    const term = new Terminal({
      // 纯系统等宽栈——不打包 webfont：latin-only 字体子集（如 JetBrains Mono）
      // 会让 xterm 按窄字宽给 CJK 算 cell，无雅黑可回退的移动浏览器上
      // 汉字字宽与 cell 错位（重叠/截断，260821 手机端实测）。系统栈测量与
      // 渲染天然一致。
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 2000,
      convertEol: false,
      cursorBlink: true,
      allowProposedApi: true,
      theme: themeFor("dark" as ThemeVariant),
    });
    // 中文等 CJK 双宽字符的宽度判定（桌面同款）——缺它中文必乱
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const ws = new TaskWs(wsUrl(task.id), {
      // 重连后快照替换全部内容（服务端尾窗覆盖断线期间的输出）
      onSnapshot: (data) => {
        term.reset();
        term.write(data);
      },
      onOutput: (data) => term.write(data),
      onStatus: setStatus,
      onConnState: setConn,
    });
    term.onData((data) => ws.sendInput(data));

    // 手机接管排版：fit 出本机列数并推给服务端 resize（TaskWs 暂存并在连接
    // 打开时自动（重）发——建连与重连后都会生效；最后一个 WS 断开时服务端
    // 还原桌面尺寸）。旋转/窗口变化 → ResizeObserver 续推。
    fit.fit();
    ws.sendResize(term.cols, term.rows);
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* 容器尚无尺寸时的正常竞态 */
      }
    });
    observer.observe(host);
    term.onResize(({ cols, rows }) => ws.sendResize(cols, rows));
    // 滚动 = SGR 鼠标 wheel 序列（\x1b[<64/65;x;yM）——Claude Code 跑在
    // alternate screen（无本地 scrollback），滚轮是它自己处理的鼠标事件；
    // TUI 忽略坐标只认按钮码。按钮与触摸滑动共用此通道。
    const wheel = (direction: 64 | 65, times: number) => {
      for (let i = 0; i < times; i++) {
        ws.sendInput(`\x1b[<${direction};10;10M`);
      }
    };
    termApiRef.current = {
      scroll: (lines: number) => wheel(lines < 0 ? 64 : 65, Math.min(4, Math.abs(lines) / 3 | 0) || 1),
      toTop: () => wheel(64, 14),
      toBottom: () => wheel(65, 14),
    };

    // 触摸滑动 → wheel 事件流：每滑过 SLIDE_STEP 像素发一个（约 3 行/个）。
    // 方向按手机「拖内容」习惯：下滑看历史（wheel up）、上滑回最新（wheel down）。
    // 无位移的触摸透传给 xterm（点选项不受影响）；CSS touch-action:none
    // 阻止浏览器整页滚动抢手势。
    const SLIDE_STEP = 32;
    let touchStartY = 0;
    let emitted = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      emitted = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const dy = touchStartY - e.touches[0].clientY; // 正=上滑
      const steps = Math.trunc(dy / SLIDE_STEP);
      while (steps > emitted) {
        emitted += 1;
        wheel(65, 1); // 上滑 → 回最新
      }
      while (steps < emitted) {
        emitted -= 1;
        wheel(64, 1); // 下滑 → 看历史
      }
    };
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: true });
    ws.start();

    return () => {
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      observer.disconnect();
      ws.close();
      term.dispose();
      termApiRef.current = null;
    };
  }, [task.id]);

  const badge = STATUS_LABEL[status] ?? { text: status, cls: "st-muted" };
  const connInfo = CONN_LABEL[conn];
  const attention = ATTENTION_STATUSES.has(status);

  return (
    <div className="task-view">
      <header className="topbar">
        <button className="back" onClick={onBack}>
          ‹ 返回
        </button>
        <span className="title">{task.name ?? task.prompt.slice(0, 40)}</span>
        <span className={`status ${badge.cls}`}>{badge.text}</span>
      </header>
      <div className="task-meta">
        <span className={`conn ${connInfo.cls}`}>{connInfo.text}</span>
        <span className="card-sub">
          {task.agent} · {task.permissionMode}
        </span>
      </div>
      {attention && (
        <div className="banner banner-attention">
          {status === "input_required" ? "任务等待你的确认——在下方终端按 y/回车应答" : "一轮已结束，等待验收"}
        </div>
      )}
      <div className="term-host" ref={termHostRef} />
      {/* 触屏滚动：TUI 开鼠标上报时 xterm 把触控拖动转发给程序、本地滚动失效，
          滑动手势（wheel 序列翻译）为主，按钮做精确定位兜底。 */}
      <div className="term-scroll-pad">
        <button className="scroll-btn" onClick={() => termApiRef.current?.toTop()} aria-label="回到顶部">
          顶
        </button>
        <button className="scroll-btn" onClick={() => termApiRef.current?.scroll(-12)} aria-label="向上滚动">
          ↑
        </button>
        <button className="scroll-btn" onClick={() => termApiRef.current?.scroll(12)} aria-label="向下滚动">
          ↓
        </button>
        <button className="scroll-btn" onClick={() => termApiRef.current?.toBottom()} aria-label="回到最新">
          底
        </button>
      </div>
    </div>
  );
}
