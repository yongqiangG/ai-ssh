/**
 * 目录列表视图（通用组件）。
 *
 * 单级列表 + 面包屑导航（不做递归树，对称 FileZilla 主视图）。
 * 本地侧（tauri fs）与远程侧（SFTP）共用。
 *
 * 拖拽（阶段 4）：每个条目 draggable，dragStart 把 {side, items} 写入 dataTransfer；
 * 面板 body 接收跨侧 drop（onDropItems）。同侧 drop 忽略（payload.side === side）。
 */
import { useEffect, useState } from "react";
import Icon from "./Icon";
import PathNavigator, { type Crumb, type NavigatePath } from "./PathNavigator";
import type { SftpEntryDTO } from "../api/sftp";
import styles from "./DirListView.module.css";

const DRAG_KEY = "application/x-ai-ssh-sftp";

export type { Crumb } from "./PathNavigator";

interface DirListViewProps {
  title: string;
  side: "local" | "remote";
  cwd: string;
  parentPath: string;
  crumbs: Crumb[];
  drives?: string[];
  entries: SftpEntryDTO[];
  loading: boolean;
  error: string | null;
  onNavigate: NavigatePath;
  /** 双击条目；调用方按 entry.directory 决定进入目录或其它动作 */
  onOpen: (entry: SftpEntryDTO) => void;
  /** 有跨侧条目拖入本面板（落点=本面板 cwd）；最小闭环仅处理文件 */
  onDropItems?: (
    sourceSide: "local" | "remote",
    items: { name: string; directory: boolean }[],
  ) => void;
  emptyHint?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
}

export default function DirListView({
  title,
  side,
  cwd,
  parentPath,
  crumbs,
  drives,
  entries,
  loading,
  error,
  onNavigate,
  onOpen,
  onDropItems,
  emptyHint,
}: DirListViewProps) {
  const currentPath = cwd;
  const [search, setSearch] = useState({ path: currentPath, value: "" });
  const query = search.path === currentPath ? search.value : "";
  const normalizedQuery = query.trim().toLowerCase();
  const filteredEntries = normalizedQuery
    ? entries.filter((entry) =>
        entry.name.toLowerCase().includes(normalizedQuery),
      )
    : entries;

  useEffect(() => {
    setSearch((previous) =>
      previous.path === currentPath
        ? previous
        : { path: currentPath, value: "" },
    );
  }, [currentPath]);

  const clearSearch = () => setSearch({ path: currentPath, value: "" });

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
      </div>

      <PathNavigator
        title={title}
        side={side}
        cwd={cwd}
        parentPath={parentPath}
        crumbs={crumbs}
        drives={drives}
        loading={loading}
        error={error}
        onNavigate={onNavigate}
      />

      <div className={styles.searchBar}>
        <Icon name="search" size={13} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="text"
          value={query}
          disabled={loading}
          placeholder="搜索当前目录"
          aria-label={`搜索${title}当前目录`}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) =>
            setSearch({ path: currentPath, value: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") clearSearch();
          }}
        />
        {query && (
          <button
            type="button"
            className={styles.clearSearch}
            aria-label="清空搜索"
            title="清空搜索"
            onClick={clearSearch}
          >
            <Icon name="close" size={12} />
          </button>
        )}
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
          <div className={styles.hint}>无法显示当前目录内容</div>
        ) : entries.length === 0 ? (
          <div className={styles.hint}>{emptyHint ?? "空目录"}</div>
        ) : filteredEntries.length === 0 ? (
          <div className={styles.hint}>
            未找到匹配“{query.trim()}”的文件或文件夹
          </div>
        ) : (
          <ul className={styles.list}>
            {filteredEntries.map((e) => (
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
                    }),
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
