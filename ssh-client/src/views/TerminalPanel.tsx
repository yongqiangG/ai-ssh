/**
 * 终端面板：多终端 tab 管理 + xterm 容器堆叠。
 *
 * ## 渲染结构与切换策略
 * 所有已打开终端的容器 div 常驻在同一个 wrapper 里绝对定位堆叠，
 * 仅激活项 visibility:visible，其余 hidden——切换 tab 只改一个 CSS 属性：
 * - 不卸载组件 → xterm 的 canvas 不重建，日志/滚动位置天然保留；
 * - visibility 不改变布局（区别于 display:none），隐藏期间容器仍有真实宽高，
 *   ResizeObserver/fit 不会算出 0，切回来也不闪烁。
 *
 * ## 组件与 manager 的分工
 * React 组件只负责「什么时候该有终端、显示哪个」；xterm 实例、轮询、输入合批
 * 都在 terminalManager（非 React 单例）里。组件经 effect 在恰当时机调 manager，
 * manager 断连时经 setOnSessionClosed 回调更新 store，形成单向环：
 * store 状态 → 组件渲染/effect → manager 动作 → 回调 → store 状态。
 */
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import Icon from "../components/Icon";
import EmptyState from "../components/EmptyState";
import { useTerminalStore } from "../stores/terminalStore";
import type { TerminalTab } from "../stores/terminalStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useChatStore } from "../stores/chatStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useThemeStore } from "../stores/themeStore";
import { getConnectionStatus } from "../api/sshConnection";
import {
  applyTerminalTheme,
  attachTerminal,
  clearTerminalSelection,
  closeTerminalFor,
  fitTerminal,
  focusTerminal,
  getRecentOutput,
  getSelectionContext,
  hasTerminal,
  markDisconnected,
  openTerminalIn,
  setOnErrorDetected,
  setOnSessionClosed,
} from "../terminal/terminalManager";
import styles from "./TerminalPanel.module.css";

/** 心跳间隔：定期核对「前端认为已连接」的连接在后端是否仍然存活 */
const HEARTBEAT_MS = 10_000;

/** F5 报错气泡自动消失时间（不打扰原则：不点击就安静走掉） */
const ERROR_BUBBLE_TTL_MS = 10_000;

/** F5 点击气泡时引用的报错前后文行数（报错常多行，取比 F1 选区 ±2 更宽的窗口） */
const ERROR_QUOTE_LINES = 12;

export default function TerminalPanel() {
  // 订阅切片：仅这些字段变化时本组件才重渲染
  const tabs = useTerminalStore((s) => s.tabs);
  const activeId = useTerminalStore((s) => s.activeId);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const themeMode = useThemeStore((s) => s.mode);

  // 主题切换时同步所有已打开终端的配色（xterm 的 theme 是创建时快照，
  // 不会自动跟随 CSS 变量）。effect 在 DOM 更新后执行，此时 data-theme
  // 已切换完毕，manager 里读到的即是新值。
  useEffect(() => {
    applyTerminalTheme();
  }, [themeMode]);

  // 注册 manager 的断连回调；挂载执行一次（依赖数组 [] 的含义），卸载时清理。
  // 注意只标记 tab 断开：shell 正常 exit 也会走到这里，此时 SSH 连接本身可能还活着，
  // 连接级状态交给下面的心跳核对，职责分开。
  useEffect(() => {
    setOnSessionClosed((connectionId) => {
      // 在回调/定时器里用 getState() 取「当下」的 store 方法，
      // 而不是把组件渲染时捕获的引用带进闭包（避免过期闭包问题）
      useTerminalStore.getState().markClosed(connectionId);
    });
    return () => setOnSessionClosed(null);
  }, []);

  // 10s 心跳：对所有「前端认为已连接」的连接查后端实时状态，
  // 失效则把连接标记为 error，并让对应终端（若有）走统一断连收尾。
  // 放在本组件意味着终端面板隐藏时心跳暂停——可接受的简化。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const { connections, markError } = useConnectionStore.getState();
      // 并行核对（连接多时避免串行 await 拖长一轮心跳）
      void Promise.allSettled(
        connections
          .filter((c) => c.status === "connected")
          .map(async (c) => {
            try {
              const alive = await getConnectionStatus(c.connectionId);
              if (!alive) {
                markError(c.connectionId);
                markDisconnected(c.connectionId);
              }
            } catch {
              // 心跳自身网络失败不武断判死（可能是瞬时抖动）；
              // 终端有独立的「连续 3 次轮询失败」判定兜底
            }
          })
      );
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);

  const onCloseTab = (connectionId: string) => {
    // manager 先释放本地资源并尽力通知后端；store 再移除 tab（触发重渲染）
    void closeTerminalFor(connectionId);
    closeTab(connectionId);
  };

  // ===== F5 报错诊断：右下角气泡（懒诊断——点击才把报错交给 AI）=====
  const errorDetectEnabled = useChatStore((s) => s.errorDetectEnabled);
  const toggleErrorDetect = useChatStore((s) => s.toggleErrorDetect);
  const [errorBubble, setErrorBubble] = useState<{
    connectionId: string;
    line: string;
  } | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setOnErrorDetected((connectionId, line) => {
      // 全局开关关闭时不打扰；只提示当前激活终端（后台 tab 的报错脱离用户视野，弹了反而误导）
      if (!useChatStore.getState().errorDetectEnabled) return;
      if (useTerminalStore.getState().activeId !== connectionId) return;
      setErrorBubble({ connectionId, line });
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = window.setTimeout(
        () => setErrorBubble(null),
        ERROR_BUBBLE_TTL_MS
      );
    });
    return () => {
      setOnErrorDetected(null);
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  // 切换 tab 后残留的气泡属于旧终端，直接收起
  useEffect(() => {
    setErrorBubble((b) => (b && b.connectionId !== activeId ? null : b));
  }, [activeId]);

  /** 点击气泡：引用报错前后文 + 诊断提问直接发送（复用 F1 的 quote 管道） */
  const askErrorDiagnosis = () => {
    if (!errorBubble) return;
    const recent = getRecentOutput(errorBubble.connectionId, ERROR_QUOTE_LINES);
    setErrorBubble(null);
    if (!recent) return;
    useChatStore.getState().setQuote({ text: recent, source: "error" });
    // 直接发送依赖 AI 面板可见，被隐藏时强制展开
    useLayoutStore.getState().setShowAiPanel(true);
    void useChatStore.getState().sendMessage("分析一下这个报错的原因，并给出修复建议");
  };

  // ===== F1 选中即问：选区浮动气泡 =====
  const stackRef = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);

  const onStackMouseUp = (e: ReactMouseEvent) => {
    if (!activeId) return;
    const { clientX, clientY } = e;
    // 延迟一帧：mouseup 时 xterm 才最终确定选区
    window.setTimeout(() => {
      const sel = getSelectionContext(activeId);
      const rect = stackRef.current?.getBoundingClientRect();
      if (sel && rect) {
        setBubble({ x: clientX - rect.left, y: clientY - rect.top });
      } else {
        setBubble(null);
      }
    }, 0);
  };

  /** 反向飞行动效（对称 CommandBlock.flyToTerminal）：引用文本从气泡飞向聊天输入区 */
  const flyToChat = (fromEl: HTMLElement, text: string) => {
    const from = fromEl.getBoundingClientRect();
    const target = document.getElementById("chat-inputbar");
    const to = target?.getBoundingClientRect() ?? {
      left: window.innerWidth - 200,
      top: window.innerHeight - 100,
      width: 0,
      height: 0,
    };
    const clone = document.createElement("div");
    clone.textContent = "❝ " + text.slice(0, 60).replace(/\n/g, " ");
    clone.style.cssText =
      "position:fixed;z-index:9999;pointer-events:none;left:" +
      from.left +
      "px;top:" +
      from.top +
      "px;max-width:280px;padding:5px 11px;border-radius:6px;background:var(--vsc-accent);color:var(--vsc-accent-fg);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 20px rgba(0,0,0,0.6),0 0 18px var(--accent-glow)";
    document.body.appendChild(clone);
    const dx = to.left + to.width / 2 - from.left;
    const dy = to.top + to.height / 2 - from.top;
    requestAnimationFrame(() => {
      clone.style.transition =
        "transform .65s cubic-bezier(.45,-.1,.6,1),opacity .65s ease-in";
      clone.style.transform = "translate(" + dx + "px," + dy + "px) scale(.5)";
      clone.style.opacity = "0";
    });
    if (target) {
      const prevShadow = target.style.boxShadow;
      const prevTransition = target.style.transition;
      target.style.transition = "box-shadow .25s ease-out";
      target.style.boxShadow = "0 0 0 2px var(--vsc-accent), 0 0 30px var(--accent-glow)";
      window.setTimeout(() => {
        target.style.boxShadow = prevShadow;
        target.style.transition = prevTransition;
      }, 550);
    }
    window.setTimeout(() => clone.remove(), 700);
  };

  const quoteSelection = (e: ReactMouseEvent) => {
    if (!activeId) return;
    const sel = getSelectionContext(activeId);
    setBubble(null);
    if (!sel) return;
    const text = [sel.before, sel.selected, sel.after].filter(Boolean).join("\n");
    flyToChat(e.currentTarget as HTMLElement, sel.selected);
    useChatStore.getState().setQuote({ text, source: "selection" });
    clearTerminalSelection(activeId);
    // 焦点切到聊天输入框（placeholder 引导 Tab 补全默认提问）
    document.getElementById("chat-input")?.focus();
  };

  const active = tabs.find((t) => t.connectionId === activeId) ?? null;

  return (
    <section
      className="panel"
      style={{
        background:
          tabs.length > 0 ? "var(--terminal-bg)" : "var(--vsc-sidebar-bg)",
      }}
    >
      <div className="panel-header">
        <div className={styles.titleWrap}>
          <Icon name="terminal" size={14} className={styles.titleIcon} />
          <span className="panel-title">终端</span>
          {active && <StatusBadge status={active.status} />}
        </div>
        <button
          type="button"
          className={`${styles.errorToggle} ${errorDetectEnabled ? styles.errorToggleOn : ""}`}
          aria-pressed={errorDetectEnabled}
          onClick={toggleErrorDetect}
          title={
            errorDetectEnabled
              ? "已开启：检测到终端报错时，右下角浮现「问问 AI」入口；点击关闭"
              : "已关闭；开启后自动检测终端输出中的报错，并提供「问问 AI」快捷入口"
          }
        >
          <span className={styles.errorToggleDot} aria-hidden />
          自动检测报错
        </button>
      </div>

      {tabs.length > 0 && (
        <div className={styles.tabbar}>
          {tabs.map((tab) => (
            <div
              key={tab.connectionId}
              className={`${styles.tab} ${
                tab.connectionId === activeId ? styles.tabActive : ""
              }`}
              onClick={() => setActive(tab.connectionId)}
              title={tab.name}
            >
              <span className={`${styles.tabDot} ${styles[tab.status]}`} />
              <span className={styles.tabName}>{tab.name}</span>
              <button
                className={styles.tabClose}
                title="关闭终端"
                aria-label={`关闭终端 ${tab.name}`}
                onClick={(e) => {
                  // 阻止冒泡：点击关闭不要触发外层 div 的「激活 tab」
                  e.stopPropagation();
                  onCloseTab(tab.connectionId);
                }}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`panel-body ${styles.body}`}>
        {tabs.length === 0 ? (
          <EmptyState
            icon="terminal"
            title="没有打开的终端"
            hint="在左侧点击一个 SSH 连接即可打开终端"
          />
        ) : (
          <div className={styles.stack} ref={stackRef} onMouseUp={onStackMouseUp}>
            {/* key=connectionId：tab 增删时 React 按 key 复用/卸载对应 Host */}
            {tabs.map((tab) => (
              <TerminalHost
                key={tab.connectionId}
                tab={tab}
                visible={tab.connectionId === activeId}
              />
            ))}
            {bubble && (
              <button
                type="button"
                className={styles.selectionBubble}
                style={{ left: bubble.x, top: Math.max(0, bubble.y - 40) }}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={quoteSelection}
              >
                <Icon name="bot" size={12} /> 引用到 AI
              </button>
            )}
            {errorBubble && (
              <div
                className={styles.errorBubble}
                onMouseUp={(e) => e.stopPropagation()}
                title={errorBubble.line}
              >
                <button
                  type="button"
                  className={styles.errorBubbleMain}
                  onClick={askErrorDiagnosis}
                >
                  <Icon name="alert" size={12} /> 检测到报错 · 问问 AI
                </button>
                <button
                  type="button"
                  className={styles.errorBubbleClose}
                  title="忽略本次"
                  onClick={() => setErrorBubble(null)}
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 单个终端的宿主容器。
 * 组件本身只渲染一个空 div，真正的终端由 manager 在 effect 里挂进来
 * （ref 拿到真实 DOM 节点后交给 xterm 的 term.open()）。
 */
function TerminalHost({ tab, visible }: { tab: TerminalTab; visible: boolean }) {
  // useRef：跨渲染保存对 DOM 节点的引用；ref.current 在首次渲染完成后才有值
  const ref = useRef<HTMLDivElement>(null);

  // 组件挂载时，若 manager 里已有该连接的终端（面板被隐藏后重新显示的场景），
  // 把既有终端 DOM 挂回这个新容器——日志保留、不重建实例
  useEffect(() => {
    if (ref.current && hasTerminal(tab.connectionId)) {
      attachTerminal(tab.connectionId, ref.current);
    }
  }, [tab.connectionId]);

  // status 为 "opening" 时执行打开流程——新开与断连后重开共用此路径
  // （重开时 manager 内部会先销毁旧实例）。effect 在渲染完成后异步执行，
  // 依赖数组 [tab.status, ...] 表示仅这些值变化时才重新运行。
  useEffect(() => {
    if (tab.status !== "opening" || !ref.current) return;
    void openTerminalIn(tab.connectionId, ref.current)
      .then(() => useTerminalStore.getState().markActive(tab.connectionId))
      .catch(() => useTerminalStore.getState().markClosed(tab.connectionId));
  }, [tab.status, tab.connectionId]);

  // 切换为可见时：容器尺寸可能在隐藏期间变了，重新 fit；
  // 并立刻聚焦，让键盘输入无需先点一下终端区域
  useEffect(() => {
    if (visible) {
      fitTerminal(tab.connectionId);
      focusTerminal(tab.connectionId);
    }
  }, [visible, tab.connectionId]);

  return (
    <div
      ref={ref}
      className={styles.host}
      style={{ visibility: visible ? "visible" : "hidden" }}
    />
  );
}

function StatusBadge({ status }: { status: TerminalTab["status"] }) {
  if (status === "active")
    return (
      <span className={`${styles.status} ${styles.ok}`}>
        <i className={styles.dot} /> 已连接
      </span>
    );
  if (status === "opening")
    return <span className={styles.status}>连接中…</span>;
  return (
    <span className={`${styles.status} ${styles.err}`}>
      <i className={styles.dot} /> 已断开
    </span>
  );
}
