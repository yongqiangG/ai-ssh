import Icon from "./Icon";
import { useLayoutStore } from "../stores/layoutStore";
import { useTerminalStore } from "../stores/terminalStore";
import type { TerminalTab } from "../stores/terminalStore";
import { useConnectionStore } from "../stores/connectionStore";
import type { SshConnection } from "../api/sshConnection";
import styles from "./Header.module.css";

export default function Header() {
  const showSidebar = useLayoutStore((s) => s.showSidebar);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const showTerminal = useLayoutStore((s) => s.showTerminal);
  const toggleTerminal = useLayoutStore((s) => s.toggleTerminal);
  const showAiPanel = useLayoutStore((s) => s.showAiPanel);
  const toggleAiPanel = useLayoutStore((s) => s.toggleAiPanel);

  // 顶栏中间显示「当前激活终端 tab」对应的连接信息：
  // tab（名称/终端状态）来自 terminalStore，主机详情按 connectionId 到 connectionStore 里找
  const tabs = useTerminalStore((s) => s.tabs);
  const activeId = useTerminalStore((s) => s.activeId);
  const connections = useConnectionStore((s) => s.connections);

  const activeTab = tabs.find((t) => t.connectionId === activeId) ?? null;
  const activeConn = activeTab
    ? connections.find((c) => c.connectionId === activeTab.connectionId) ?? null
    : null;

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <span className={styles.brand}>
          <span className={styles.brandBolt}>⚡</span>
          AI-SSH
        </span>
      </div>

      <div className={styles.center}>
        <ConnectionInfo tab={activeTab} conn={activeConn} />
      </div>

      {/* 面板显隐开关组：图标即区域（左栏 / 终端区 / 右栏），点亮 = 显示中 */}
      <div className={styles.right}>
        <div
          className={styles.panelGroup}
          role="group"
          aria-label="面板显示开关"
        >
          <button
            type="button"
            className={`${styles.panelBtn} ${showSidebar ? styles.on : ""}`}
            title={showSidebar ? "隐藏左侧连接面板" : "显示左侧连接面板"}
            aria-pressed={showSidebar}
            onClick={toggleSidebar}
          >
            <Icon name="panelLeft" size={16} />
          </button>
          <button
            type="button"
            className={`${styles.panelBtn} ${showTerminal ? styles.on : ""}`}
            title={showTerminal ? "隐藏终端" : "显示终端"}
            aria-pressed={showTerminal}
            onClick={toggleTerminal}
          >
            <Icon name="panelTerminal" size={16} />
          </button>
          <button
            type="button"
            className={`${styles.panelBtn} ${showAiPanel ? styles.on : ""}`}
            title={showAiPanel ? "隐藏 AI 助手面板" : "显示 AI 助手面板"}
            aria-pressed={showAiPanel}
            onClick={toggleAiPanel}
          >
            <Icon name="panelRight" size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}

/** 激活终端的连接信息条；无激活终端时显示引导文案 */
function ConnectionInfo({
  tab,
  conn,
}: {
  tab: TerminalTab | null;
  conn: SshConnection | null;
}) {
  if (!tab) {
    return (
      <span className={styles.idle}>
        <Icon name="server" size={12} className={styles.idleIcon} />
        未连接 · 在左侧连接面板新建
      </span>
    );
  }

  // 终端 tab 状态 → 展示样式：opening=连接中 / active=已连接 / closed=已断开
  const status =
    tab.status === "active"
      ? "ok"
      : tab.status === "opening"
      ? "connecting"
      : "error";
  const statusText =
    tab.status === "active"
      ? "已连接"
      : tab.status === "opening"
      ? "连接中"
      : "已断开";

  return (
    <div className={styles.connInfo}>
      <span className={`${styles.dot} ${styles[status]}`} />
      <span className={styles.connName}>{tab.name}</span>
      {conn && (
        <span className={styles.connHost}>
          {conn.username}@{conn.host}:{conn.port}
        </span>
      )}
      <span className={`${styles.badge} ${styles[status]}`}>{statusText}</span>
    </div>
  );
}
