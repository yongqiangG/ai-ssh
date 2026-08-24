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
  // 顶/底按钮与工具条触达闭包内的实现（按钮渲染在 effect 外）
  const termApiRef = useRef<{
    toTop: () => void;
    toBottom: () => void;
    send: (seq: string) => void;
  } | null>(null);
  const [status, setStatus] = useState(task.status);
  const [conn, setConn] = useState<WsConnState>("connecting");

  useEffect(() => {
    const host = termHostRef.current;
    if (!host) return;
    // 终端模式（快照 alt 标志，260824 terminal-ux）：true=alt 屏（Claude 型
    // TUI，历史在应用内部，滚动发远程序列）；false=普通屏（Codex 型，历史
    // 在 xterm 本地 scrollback，滚动走本地 API，零 RTT）。
    let altScreen = false;
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
      // 重连后快照替换全部内容；alt 标志同步刷新交互模式
      onSnapshot: (data, alt) => {
        altScreen = alt;
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

    // ── 双模式滚动层（260824 terminal-ux Q1/Q2/Q3）───────────────────────
    // alt 屏：滚动 = 发序列给 TUI（wheel 细滚 / PgUp/PgDn 翻页 / Home/End
    //   直达），每步感知延迟 = RTT（已知天花板）；
    // 普通屏：滚动 = xterm 本地 API（历史就在本地 scrollback），瞬时零 RTT，
    //   零字节进 PTY——任务进程无感知。
    const SEQ = {
      wheelUp: "\x1b[<64;10;10M",
      wheelDown: "\x1b[<65;10;10M",
      pageUp: "\x1b[5~",
      pageDown: "\x1b[6~",
      home: "\x1b[H",
      end: "\x1b[F",
    };
    /** 细滚：alt 屏发 1 个 wheel（TUI 自释 ≈3 行），普通屏本地滚 3 行。 */
    const nudge = (down: boolean) => {
      if (altScreen) {
        ws.sendInput(down ? SEQ.wheelDown : SEQ.wheelUp);
      } else {
        term.scrollLines(down ? 3 : -3);
      }
    };
    /** 翻页（fling 用，pages 1-3 按速度分档）：alt 屏 PgUp/PgDn ×N，
     *  普通屏本地 scrollPages。 */
    const page = (down: boolean, pages: number) => {
      const n = Math.min(3, Math.max(1, pages));
      if (altScreen) {
        for (let i = 0; i < n; i++) {
          ws.sendInput(down ? SEQ.pageDown : SEQ.pageUp);
        }
      } else {
        term.scrollPages(down ? n : -n);
      }
    };
    termApiRef.current = {
      toTop: () => (altScreen ? ws.sendInput(SEQ.home) : term.scrollToTop()),
      toBottom: () => (altScreen ? ws.sendInput(SEQ.end) : term.scrollToBottom()),
      send: (seq: string) => ws.sendInput(seq),
    };

    // 触摸滑动：慢滑按 SLIDE_STEP（32px≈3 行）步进；抬指时按末段速度判
    // fling（>0.5px/ms 翻页，速度分档 1-3 页）。方向按手机「拖内容」习惯：
    // 下滑看历史、上滑回最新。无位移的触摸透传给 xterm（点选项不受影响）；
    // CSS touch-action:none 阻止浏览器整页滚动抢手势。
    const SLIDE_STEP = 32;
    const FLING_VELOCITY = 0.5; // px/ms
    let touchStartY = 0;
    let emitted = 0;
    // 末段速度采样：只记最后一个 move 点（fling 判据用最近 ~1 帧位移）
    let lastY = 0;
    let lastT = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      lastY = touchStartY;
      lastT = performance.now();
      emitted = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      const dy = touchStartY - y; // 正=上滑（回最新）
      lastY = y;
      lastT = performance.now();
      const steps = Math.trunc(dy / SLIDE_STEP);
      while (steps > emitted) {
        emitted += 1;
        nudge(true); // 上滑 → 回最新
      }
      while (steps < emitted) {
        emitted -= 1;
        nudge(false); // 下滑 → 看历史
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const dt = performance.now() - lastT;
      if (dt === 0 || e.changedTouches.length === 0) return;
      // 末段速度（px/ms）：只对最近的位移判 fling，长滑整体平均会低估
      const velocity = (lastY - e.changedTouches[0].clientY) / dt;
      if (Math.abs(velocity) < FLING_VELOCITY) return;
      // 速度分档：0.5/1.2/2.5 px/ms → 1/2/3 页
      const tier = Math.abs(velocity) > 2.5 ? 3 : Math.abs(velocity) > 1.2 ? 2 : 1;
      page(velocity > 0, tier);
    };
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: true });
    host.addEventListener("touchend", onTouchEnd, { passive: true });
    ws.start();

    return () => {
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
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
      {/* 触屏滚动：慢滑/fling 双模式手势（alt 屏远程序列 / 普通屏本地 API，
          260824 terminal-ux），顶/底一击即达做精确定位。 */}
      <div className="term-jump-pad">
        <button className="jump-btn" onClick={() => termApiRef.current?.toTop()} aria-label="回到顶部">
          顶
        </button>
        <button className="jump-btn" onClick={() => termApiRef.current?.toBottom()} aria-label="回到最新">
          底
        </button>
      </div>
      {/* 输入工具条（260824 Q4）：手机软键盘没有 Ctrl/Esc/Tab——常驻细条
          直发标准控制序列，agent 原生语义解释（Esc=Claude 打断/Codex 取消；
          ^C=清空输入，退出确认由 agent 双击交互把关）。 */}
      <div className="term-toolbar">
        <button className="tool-btn" onClick={() => termApiRef.current?.send("\x1b")}>
          Esc
        </button>
        <button className="tool-btn" onClick={() => termApiRef.current?.send("\x03")}>
          ^C
        </button>
        <button className="tool-btn" onClick={() => termApiRef.current?.send("\x09")}>
          Tab
        </button>
        <button className="tool-btn" onClick={() => termApiRef.current?.send("\x1b[A")} aria-label="上方向键">
          ↑
        </button>
        <button className="tool-btn" onClick={() => termApiRef.current?.send("\x1b[B")} aria-label="下方向键">
          ↓
        </button>
      </div>
    </div>
  );
}
