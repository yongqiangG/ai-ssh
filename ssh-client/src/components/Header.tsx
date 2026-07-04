import { useState } from "react";
import Icon from "./Icon";
import SshConnectionModal from "./sshConnectionModal";
import { useLayoutStore } from "../stores/layoutStore";
import { useTerminalStore } from "../stores/terminalStore";
import type { ConnectionState, SshServer } from "../types";
import styles from "./Header.module.css";

export default function Header() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const showSidebar = useLayoutStore((s) => s.showSidebar);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const showTerminal = useLayoutStore((s) => s.showTerminal);
  const toggleTerminal = useLayoutStore((s) => s.toggleTerminal);
  const showAiPanel = useLayoutStore((s) => s.showAiPanel);
  const toggleAiPanel = useLayoutStore((s) => s.toggleAiPanel);

  const connection = useTerminalStore((s) => s.connection);
  const connectedServer = useTerminalStore((s) => s.connectedServer);

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <button
          type="button"
          className={styles.iconBtn}
          title={showSidebar ? "折叠侧栏" : "展开侧栏"}
          aria-pressed={showSidebar}
          onClick={toggleSidebar}
        >
          <Icon name="menu" size={16} />
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.addBtn}`}
          title="新建 SSH 连接"
          onClick={() => setDialogOpen(true)}
        >
          <Icon name="add" size={16} />
        </button>
      </div>

      <div className={styles.center}>
        <ConnectionInfo connection={connection} server={connectedServer} />
      </div>

      <div className={styles.right}>
        <button
          type="button"
          className={`${styles.iconBtn} ${
            showTerminal ? styles.active : styles.inactive
          }`}
          title={showTerminal ? "隐藏终端" : "显示终端"}
          aria-pressed={showTerminal}
          onClick={toggleTerminal}
        >
          <Icon name="terminal" size={16} />
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${
            showAiPanel ? styles.active : styles.inactive
          }`}
          title={showAiPanel ? "隐藏 AI 助手" : "显示 AI 助手"}
          aria-pressed={showAiPanel}
          onClick={toggleAiPanel}
        >
          <Icon name="bot" size={16} />
        </button>
      </div>

      <SshConnectionModal
        open={dialogOpen}
        mode="create"
        initial={null}
        onClose={() => setDialogOpen(false)}
      />
    </header>
  );
}

function ConnectionInfo({
  connection,
  server,
}: {
  connection: ConnectionState;
  server: SshServer | null;
}) {
  if (!server || connection === "disconnected") {
    return (
      <span className={styles.idle}>
        <Icon name="server" size={12} className={styles.idleIcon} />
        未连接 · 点击 <span className={styles.kbd}>+</span> 添加服务器
      </span>
    );
  }

  const status =
    connection === "connected"
      ? "ok"
      : connection === "connecting"
      ? "connecting"
      : "error";
  const statusText =
    connection === "connected"
      ? "已连接"
      : connection === "connecting"
      ? "连接中"
      : "连接错误";

  return (
    <div className={styles.connInfo}>
      <span className={`${styles.dot} ${styles[status]}`} />
      <span className={styles.connName}>{server.name}</span>
      <span className={styles.connHost}>
        {server.username}@{server.host}:{server.port}
      </span>
      <span className={`${styles.badge} ${styles[status]}`}>{statusText}</span>
    </div>
  );
}
