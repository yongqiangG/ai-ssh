import { useMemo, useState } from "react";
import Icon from "../components/Icon";
import EmptyState from "../components/EmptyState";
import ServerFormDialog, {
  type ServerFormInput,
} from "../components/ServerFormDialog";
import { useServersStore } from "../stores/serversStore";
import type { SshServer } from "../types";
import styles from "./ServersPanel.module.css";

export default function ServersPanel() {
  const servers = useServersStore((s) => s.servers);
  const selectedId = useServersStore((s) => s.selectedId);
  const addServer = useServersStore((s) => s.addServer);
  const updateServer = useServersStore((s) => s.updateServer);
  const removeServer = useServersStore((s) => s.removeServer);
  const selectServer = useServersStore((s) => s.selectServer);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SshServer | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // 按 group 字段分组（缺省归入"默认"）
  const groups = useMemo(() => {
    const map = new Map<string, SshServer[]>();
    for (const s of servers) {
      const g = s.group?.trim() || "默认";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return Array.from(map.entries());
  }, [servers]);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (s: SshServer) => {
    setEditing(s);
    setDialogOpen(true);
  };
  const handleSubmit = (input: ServerFormInput) => {
    if (editing) updateServer(editing.id, input);
    else addServer(input);
    setDialogOpen(false);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">SSH 服务器</span>
        <div className="panel-actions">
          <button
            className="icon-btn"
            title="新增服务器"
            onClick={openAdd}
          >
            <Icon name="add" />
          </button>
        </div>
      </div>

      <div className="panel-body">
        {servers.length === 0 ? (
          <EmptyState
            icon="server"
            title="还没有服务器"
            hint="添加一台 SSH 服务器以开始连接"
            action={
              <button className="btn" onClick={openAdd}>
                <Icon name="add" size={14} />
                新增服务器
              </button>
            }
          />
        ) : (
          <div className={styles.list}>
            {groups.map(([group, items]) => (
              <div key={group} className={styles.group}>
                <div className={styles.groupHeader}>{group}</div>
                {items.map((s) => (
                  <ServerItem
                    key={s.id}
                    server={s}
                    selected={s.id === selectedId}
                    pendingDelete={pendingDelete === s.id}
                    onSelect={() => selectServer(s.id)}
                    onEdit={() => openEdit(s)}
                    onAskDelete={() => setPendingDelete(s.id)}
                    onCancelDelete={() => setPendingDelete(null)}
                    onConfirmDelete={() => {
                      removeServer(s.id);
                      setPendingDelete(null);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <ServerFormDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
      />
    </section>
  );
}

interface ServerItemProps {
  server: SshServer;
  selected: boolean;
  pendingDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function ServerItem({
  server,
  selected,
  pendingDelete,
  onSelect,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: ServerItemProps) {
  return (
    <div
      className={`${styles.item} ${selected ? styles.selected : ""}`}
      onClick={onSelect}
      title={`${server.username}@${server.host}:${server.port}`}
    >
      <div className={styles.itemMain}>
        <Icon name="server" size={16} className={styles.itemIcon} />
        <div className={styles.itemText}>
          <div className={styles.itemName}>{server.name}</div>
          <div className={styles.itemSub}>
            {server.username}@{server.host}:{server.port}
          </div>
        </div>
      </div>

      {pendingDelete ? (
        <div
          className={styles.confirm}
          onClick={(e) => e.stopPropagation()}
        >
          <span className={styles.confirmText}>删除？</span>
          <button
            className={`${styles.miniBtn} ${styles.miniDanger}`}
            onClick={onConfirmDelete}
          >
            删除
          </button>
          <button className={styles.miniBtn} onClick={onCancelDelete}>
            取消
          </button>
        </div>
      ) : (
        <div
          className={styles.itemActions}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="icon-btn" title="编辑" onClick={onEdit}>
            <Icon name="edit" size={14} />
          </button>
          <button
            className="icon-btn danger"
            title="删除"
            onClick={onAskDelete}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}

      {selected && <div className={styles.accent} />}
    </div>
  );
}
