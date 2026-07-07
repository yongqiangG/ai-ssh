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
import { useEffect, useRef } from "react";
import Icon from "../components/Icon";
import EmptyState from "../components/EmptyState";
import { useTerminalStore } from "../stores/terminalStore";
import type { TerminalTab } from "../stores/terminalStore";
import { useConnectionStore } from "../stores/connectionStore";
import { getConnectionStatus } from "../api/sshConnection";
import {
  attachTerminal,
  closeTerminalFor,
  fitTerminal,
  focusTerminal,
  hasTerminal,
  markDisconnected,
  openTerminalIn,
  setOnSessionClosed,
} from "../terminal/terminalManager";
import styles from "./TerminalPanel.module.css";

/** 心跳间隔：定期核对「前端认为已连接」的连接在后端是否仍然存活 */
const HEARTBEAT_MS = 10_000;

export default function TerminalPanel() {
  // 订阅切片：仅这些字段变化时本组件才重渲染
  const tabs = useTerminalStore((s) => s.tabs);
  const activeId = useTerminalStore((s) => s.activeId);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeTab = useTerminalStore((s) => s.closeTab);

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
    const timer = window.setInterval(async () => {
      const { connections, markError } = useConnectionStore.getState();
      for (const c of connections) {
        if (c.status !== "connected") continue;
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
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);

  const onCloseTab = (connectionId: string) => {
    // manager 先释放本地资源并尽力通知后端；store 再移除 tab（触发重渲染）
    void closeTerminalFor(connectionId);
    closeTab(connectionId);
  };

  const active = tabs.find((t) => t.connectionId === activeId) ?? null;

  return (
    <section className="panel" style={{ background: "var(--terminal-bg)" }}>
      <div className="panel-header">
        <div className={styles.titleWrap}>
          <Icon name="terminal" size={14} className={styles.titleIcon} />
          <span className="panel-title">终端</span>
          {active && <StatusBadge status={active.status} />}
        </div>
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
                onClick={(e) => {
                  // 阻止冒泡：点击 × 不要触发外层 div 的「激活 tab」
                  e.stopPropagation();
                  onCloseTab(tab.connectionId);
                }}
              >
                ×
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
          <div className={styles.stack}>
            {/* key=connectionId：tab 增删时 React 按 key 复用/卸载对应 Host */}
            {tabs.map((tab) => (
              <TerminalHost
                key={tab.connectionId}
                tab={tab}
                visible={tab.connectionId === activeId}
              />
            ))}
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
