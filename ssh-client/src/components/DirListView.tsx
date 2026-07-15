/**
 * 目录列表视图（通用组件）。
 *
 * 单级列表 + 面包屑导航（不做递归树，对称 FileZilla 主视图）。
 * 本地侧（tauri fs）与远程侧（SFTP）共用。
 *
 * 拖拽（阶段 4）：每个条目 draggable，dragStart 把 {side, items} 写入 dataTransfer；
 * 面板 body 接收跨侧 drop（onDropItems）。同侧 drop 忽略（payload.side === side）。
 */
import Icon from "./Icon";
import type { SftpEntryDTO } from "../api/sftp";
import styles from "./DirListView.module.css";

const DRAG_KEY = "application/x-ai-ssh-sftp";

export interface Crumb {
  label: string;
  /** 点击该段后要 list 的路径（本地/远程各自语义） */
  path: string;
}

interface DirListViewProps {
  title: string;
  side: "local" | "remote";
  crumbs: Crumb[];
  entries: SftpEntryDTO[];
  loading: boolean;
  error: string | null;
  onCrumbClick: (path: string) => void;
  /** 双击条目；调用方按 entry.directory 决定进入目录或其它动作 */
  onOpen: (entry: SftpEntryDTO) => void;
  onRefresh: () => void;
  /** 有跨侧条目拖入本面板（落点=本面板 cwd）；最小闭环仅处理文件 */
  onDropItems?: (
    sourceSide: "local" | "remote",
    items: { name: string; directory: boolean }[]
  ) => void;
  /** 可选：弹出系统目录选择器（本地侧用，Windows 下跨盘切换） */
  onPickDir?: () => void;
  emptyHint?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
}

export default function DirListView({
  title,
  side,
  crumbs,
  entries,
  loading,
  error,
  onCrumbClick,
  onOpen,
  onRefresh,
  onDropItems,
  onPickDir,
  emptyHint,
}: DirListViewProps) {
  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <div className={styles.headerActions}>
          {onPickDir && (
            <button className="icon-btn" title="选择目录" onClick={onPickDir}>
              <Icon name="folder" size={13} />
            </button>
          )}
          <button className="icon-btn" title="刷新" onClick={onRefresh}>
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </div>

      <div className={styles.crumbs}>
        {crumbs.map((c, i) => (
          <span key={i} className={styles.crumbItem}>
            {i > 0 && <span className={styles.sep}>›</span>}
            <button
              className={styles.crumbBtn}
              onClick={() => onCrumbClick(c.path)}
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>

      <div
        className={styles.body}
        onDragOver={(ev) => {
          if (onDropItems) ev.preventDefault();
        }}
        onDrop={(ev) => {
          ev.preventDefault();
          if (!onDropItems) return;
          const data = ev.dataTransfer.getData(DRAG_KEY);
          if (!data) return;
          try {
            const payload = JSON.parse(data) as {
              side: "local" | "remote";
              items: { name: string; directory: boolean }[];
            };
            // 仅跨侧拖拽触发传输
            if (payload.side !== side) onDropItems(payload.side, payload.items);
          } catch {
            /* 忽略非法 payload */
          }
        }}
      >
        {loading ? (
          <div className={styles.hint}>加载中…</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : entries.length === 0 ? (
          <div className={styles.hint}>{emptyHint ?? "空目录"}</div>
        ) : (
          <ul className={styles.list}>
            {entries.map((e) => (
              <li
                key={e.name}
                className={styles.row}
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(
                    DRAG_KEY,
                    JSON.stringify({
                      side,
                      items: [{ name: e.name, directory: e.directory }],
                    })
                  );
                  ev.dataTransfer.effectAllowed = "copy";
                }}
                onDoubleClick={() => onOpen(e)}
                title={
                  e.directory ? e.name : `${e.name} · ${formatSize(e.size)}`
                }
              >
                <Icon
                  name={e.directory ? "folder" : "file"}
                  size={14}
                  className={e.directory ? styles.folderIcon : styles.fileIcon}
                />
                <span className={styles.name}>{e.name}</span>
                {!e.directory && e.size > 0 && (
                  <span className={styles.size}>{formatSize(e.size)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
