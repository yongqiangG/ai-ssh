import Icon from "../components/Icon";
import EmptyState from "../components/EmptyState";
import TerminalView from "../components/TerminalView";
import { useServersStore } from "../stores/serversStore";
import { useTerminalStore } from "../stores/terminalStore";
import type { ConnectionState } from "../types";
import styles from "./TerminalPanel.module.css";

export default function TerminalPanel() {
  const servers = useServersStore((s) => s.servers);
  const selectedId = useServersStore((s) => s.selectedId);
  const selected = servers.find((s) => s.id === selectedId) ?? null;

  const connection = useTerminalStore((s) => s.connection);
  const connectedServer = useTerminalStore((s) => s.connectedServer);
  const connect = useTerminalStore((s) => s.connect);
  const disconnect = useTerminalStore((s) => s.disconnect);
  const lines = useTerminalStore((s) => s.lines);

  const isActive = connection === "connected" || connection === "connecting";
  const target = connectedServer ?? selected;
  const showTerminal = isActive || lines.length > 0;

  const onToggle = () => {
    if (isActive) void disconnect();
    else if (selected) void connect(selected);
  };

  return (
    <section className="panel" style={{ background: "var(--terminal-bg)" }}>
      <div className="panel-header">
        <div className={styles.titleWrap}>
          <Icon name="terminal" size={14} className={styles.titleIcon} />
          <span className="panel-title">{target ? target.name : "终端"}</span>
          <StatusBadge connection={connection} />
        </div>
        <div className="panel-actions">
          <button
            className="icon-btn"
            title={isActive ? "断开" : "连接"}
            disabled={!target || connection === "connecting"}
            onClick={onToggle}
          >
            <Icon name={isActive ? "disconnect" : "connect"} />
          </button>
        </div>
      </div>

      <div className="panel-body">
        {!target ? (
          <EmptyState
            icon="terminal"
            title="未选择服务器"
            hint="在左侧选择一台服务器后点击连接"
          />
        ) : !showTerminal ? (
          <EmptyState
            icon="connect"
            title={`准备连接 ${target.name}`}
            hint="点击右上角连接按钮，进入命令操作区"
          />
        ) : (
          <TerminalView />
        )}
      </div>
    </section>
  );
}

function StatusBadge({ connection }: { connection: ConnectionState }) {
  if (connection === "connected")
    return (
      <span className={`${styles.status} ${styles.ok}`}>
        <i className={styles.dot} /> 已连接
      </span>
    );
  if (connection === "connecting")
    return <span className={styles.status}>连接中…</span>;
  if (connection === "error")
    return (
      <span className={`${styles.status} ${styles.err}`}>
        <i className={styles.dot} /> 连接错误
      </span>
    );
  return null;
}
