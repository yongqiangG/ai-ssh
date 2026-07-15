import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import EmptyState from "../components/EmptyState";
import SshConnectionModal from "../components/sshConnectionModal";
import BackendSettingsModal from "../components/BackendSettingsModal";
import { useBackendStore } from "../stores/backendStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useTerminalStore } from "../stores/terminalStore";
import type { SshConnection } from "../api/sshConnection";
import type { ConnectionState } from "../types";
import styles from "./ConnectionsPanel.module.css";

const STATUS_LABEL: Record<ConnectionState, string> = {
  connected: "已连接",
  connecting: "连接中",
  disconnected: "未连接",
  error: "失败",
};

export default function ConnectionsPanel() {
  const connections = useConnectionStore((s) => s.connections);
  const loading = useConnectionStore((s) => s.loading);
  const error = useConnectionStore((s) => s.error);
  const fetchList = useConnectionStore((s) => s.fetchList);
  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const remove = useConnectionStore((s) => s.remove);
  const readyStatus = useBackendStore((s) => s.readyStatus);
  const readyMessage = useBackendStore((s) => s.readyMessage);
  const waitForReady = useBackendStore((s) => s.waitForReady);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SshConnection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const openTab = useTerminalStore((s) => s.openTab);
  const activeId = useTerminalStore((s) => s.activeId);
  const setCenterView = useLayoutStore((s) => s.setCenterView);
  const setShowTerminal = useLayoutStore((s) => s.setShowTerminal);

  useEffect(() => {
    if (readyStatus !== "ready") return;
    const s = useConnectionStore.getState();
    if (s.connections.length === 0 && !s.loading) void s.fetchList();
  }, [readyStatus]);

  const reloadAfterReady = async () => {
    await waitForReady();
    await fetchList();
  };

  const activateTerminal = (c: SshConnection) => {
    setCenterView("terminal");
    setShowTerminal(true);
    openTab(c.connectionId, c.name);
  };

  /**
   * 点击卡片主体：自动发起连接并打开终端（无需先选中再点连接按钮）。
   * 已连接 → 直接打开/激活终端 tab；未连接/失败 → 先 connect 成功后再打开。
   */
  const openTerminalFor = async (c: SshConnection) => {
    if (c.status === "connecting") return;
    if (c.status === "connected") {
      activateTerminal(c);
      return;
    }
    try {
      await connect(c.connectionId);
      activateTerminal(c);
    } catch {
      // 连接失败：store 已把该连接置为 error 并显示在卡片上，这里无需额外处理
    }
  };

  const toggleConnection = async (c: SshConnection) => {
    if (c.status === "connecting") return;
    if (c.status === "connected") {
      try {
        await disconnect(c.connectionId);
      } catch {
        // store 会刷新状态并展示错误，这里不打断用户操作。
      }
      return;
    }
    try {
      await connect(c.connectionId);
      activateTerminal(c);
    } catch {
      // 连接失败时保持在列表，错误状态由 store 展示。
    }
  };

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (c: SshConnection) => {
    setEditing(c);
    setModalOpen(true);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">SSH 连接</span>
        <div className="panel-actions">
          <button className="icon-btn" title="刷新" onClick={() => void fetchList()}>
            <Icon name="refresh" size={14} />
          </button>
          <button
            className="icon-btn"
            title="后端服务地址"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" size={14} />
          </button>
          <button className="icon-btn" title="新建连接" onClick={openCreate}>
            <Icon name="add" size={16} />
          </button>
        </div>
      </div>

      <div className="panel-body">
        {readyStatus === "checking" ? (
          <EmptyState
            icon="server"
            title="正在启动后端服务"
            hint="服务就绪后会自动加载服务器列表"
          />
        ) : readyStatus === "fail" ? (
          <EmptyState
            icon="server"
            title="后端服务未就绪"
            hint={readyMessage ?? "请检查 sidecar 启动状态或后端服务地址"}
            action={
              <button className="btn" onClick={() => void reloadAfterReady()}>
                <Icon name="refresh" size={14} />
                重试
              </button>
            }
          />
        ) : loading && connections.length === 0 ? (
          <div className={styles.list}>
            <div className={styles.card}>
              <span className={styles.sub}>加载中…</span>
            </div>
          </div>
        ) : connections.length === 0 ? (
          <EmptyState
            icon="server"
            title={error ? "加载失败" : "还没有连接"}
            hint={error ?? "新建一个 SSH 连接以开始管理"}
            action={
              <button className="btn" onClick={openCreate}>
                <Icon name="add" size={14} />
                新建连接
              </button>
            }
          />
        ) : (
          <div className={styles.list}>
            {connections.map((c) => (
              <ConnectionCard
                key={c.connectionId}
                connection={c}
                isCurrent={c.connectionId === activeId}
                pendingDelete={pendingDelete === c.connectionId}
                onOpen={() => void openTerminalFor(c)}
                onToggle={() => void toggleConnection(c)}
                onEdit={() => openEdit(c)}
                onAskDelete={() => setPendingDelete(c.connectionId)}
                onCancelDelete={() => setPendingDelete(null)}
                onConfirmDelete={async () => {
                  await remove(c.connectionId);
                  setPendingDelete(null);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <SshConnectionModal
        open={modalOpen}
        mode={editing ? "edit" : "create"}
        initial={editing}
        onClose={() => setModalOpen(false)}
      />
      <BackendSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </section>
  );
}

interface ConnectionCardProps {
  connection: SshConnection;
  /** 是否当前选中（终端活跃连接，与 SFTP 连接共用锚点） */
  isCurrent: boolean;
  pendingDelete: boolean;
  /** 点击卡片主体：自动连接并打开终端 */
  onOpen: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<void>;
}

function ConnectionCard({
  connection,
  isCurrent,
  pendingDelete,
  onOpen,
  onToggle,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: ConnectionCardProps) {
  const { status } = connection;
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className={`${styles.card} ${isCurrent ? styles.cardActive : ""}`} title={`${connection.username}@${connection.host}:${connection.port}`}>
      <div className={`${styles.cardMain} ${styles.clickable}`} onClick={onOpen}>
        <span className={`${styles.dot} ${styles[status]}`} />
        <div className={styles.nameWrap}>
          <span className={styles.name}>{connection.name}</span>
          <span className={styles.sub}>
            {connection.username}@{connection.host}:{connection.port}
          </span>
        </div>
        <span className={`${styles.badge} ${styles[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {pendingDelete ? (
        <div className={styles.cardFoot}>
          <span className={styles.confirmText}>确认删除该连接？</span>
          <div className={styles.confirm}>
            <button className={`${styles.miniBtn} ${styles.miniDanger}`} onClick={onConfirmDelete}>
              删除
            </button>
            <button className={styles.miniBtn} onClick={onCancelDelete}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.cardFoot}>
          <button
            className={`${styles.switch} ${isConnected ? styles.on : ""}`}
            type="button"
            role="switch"
            aria-checked={isConnected}
            disabled={isConnecting}
            title={isConnected ? "点击断开" : "点击连接"}
            onClick={onToggle}
          >
            <span className={styles.knob} />
          </button>
          <div className={styles.actions}>
            <button className="icon-btn" title="编辑" onClick={onEdit}>
              <Icon name="edit" size={14} />
            </button>
            <button
              className="icon-btn danger"
              title="删除"
              disabled={isConnecting}
              onClick={onAskDelete}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
