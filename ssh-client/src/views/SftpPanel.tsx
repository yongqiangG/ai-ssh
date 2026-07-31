/**
 * SFTP 文件传输面板（中间工作区视图）。
 *
 * 布局：顶部连接选择器（仅 connected，默认锚定 terminalStore.activeId）
 * + 双栏（左本地 / 右远程，通用 DirListView）+ 底部传输进度（transfers）。
 *
 * 拖拽：本地条目→远程侧=上传；远程条目→本地侧=下载。落点=目标侧 cwd；
 * 同名落前 confirm 覆盖/取消；文件夹拖拽提示不支持。
 *
 * 切到此视图时 TerminalPanel 由 App.tsx 用 visibility 隐藏保留（不卸载，会话不丢）。
 */
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { stat } from "@tauri-apps/plugin-fs";
import ConfirmDialog from "../components/ConfirmDialog";
import TransferTrack from "../components/TransferTrack";
import Icon from "../components/Icon";
import DirListView from "../components/DirListView";
import EmptyState from "../components/EmptyState";
import {
  useSftpStore,
  joinRemotePath,
  remoteCrumbs,
  joinLocalPath,
  localCrumbs,
} from "../stores/sftpStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useTerminalStore } from "../stores/terminalStore";
import styles from "./SftpPanel.module.css";

export default function SftpPanel() {
  const connections = useConnectionStore((s) => s.connections);
  const activeId = useTerminalStore((s) => s.activeId);

  const connectionId = useSftpStore((s) => s.connectionId);
  const remoteCwd = useSftpStore((s) => s.remoteCwd);
  const remoteEntries = useSftpStore((s) => s.remoteEntries);
  const loading = useSftpStore((s) => s.loading);
  const error = useSftpStore((s) => s.error);
  const setConnection = useSftpStore((s) => s.setConnection);
  const openRemoteDir = useSftpStore((s) => s.openRemoteDir);
  const refreshRemote = useSftpStore((s) => s.refreshRemote);

  const localCwd = useSftpStore((s) => s.localCwd);
  const localEntries = useSftpStore((s) => s.localEntries);
  const localLoading = useSftpStore((s) => s.localLoading);
  const localError = useSftpStore((s) => s.localError);
  const initLocal = useSftpStore((s) => s.initLocal);
  const openLocalDir = useSftpStore((s) => s.openLocalDir);
  const refreshLocal = useSftpStore((s) => s.refreshLocal);

  const transfers = useSftpStore((s) => s.transfers);
  const upload = useSftpStore((s) => s.upload);
  const download = useSftpStore((s) => s.download);
  const openDownload = useSftpStore((s) => s.openDownload);
  const clearTransfer = useSftpStore((s) => s.clearTransfer);

  const currentName =
    connections.find((c) => c.connectionId === connectionId)?.name ?? "";
  const crumbs = remoteCrumbs(remoteCwd);
  const localCrumbsList = localCwd ? localCrumbs(localCwd) : [];

  // SFTP 连接始终跟随终端活跃连接（已移除下拉，由左侧服务器列表选中决定）
  useEffect(() => {
    const ok =
      !!activeId &&
      connections.some(
        (c) => c.connectionId === activeId && c.status === "connected",
      );
    if (ok && connectionId !== activeId) setConnection(activeId);
    else if (!ok && connectionId) setConnection(null);
  }, [activeId, connectionId, connections, setConnection]);

  // 首次挂载：初始化本地家目录（web dev 下 readDir 不可用，store 内容错）
  useEffect(() => {
    void initLocal();
  }, [initLocal]);

  // 应用内确认/提示弹窗（主题统一，替代 OS 原生 dialog）
  const [dialog, setDialog] = useState<{
    message: string;
    kind: "warning" | "info";
    resolve: (ok: boolean) => void;
  } | null>(null);
  const showModal = (msg: string, kind: "warning" | "info" = "warning") =>
    new Promise<boolean>((resolve) =>
      setDialog({ message: msg, kind, resolve }),
    );

  // 单文件传输上限（与后端 SftpController.MAX_UPLOAD_BYTES 对齐），客户端预检阻断
  const LIMIT_BYTES = 100 * 1024 * 1024;
  const fmtBytes = (n: number) => {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  };

  /** 跨侧拖拽落点协调：local→remote 上传，remote→local 下载 */
  const handleDrop = async (
    targetSide: "local" | "remote",
    sourceSide: "local" | "remote",
    items: { name: string; directory: boolean }[],
  ) => {
    if (sourceSide === targetSide) return;
    const dirs = items.filter((i) => i.directory);
    if (dirs.length) {
      // 应用内提示（主题统一）：webview 的 window.alert/confirm 在 drop 事件下常被抑制
      await showModal("暂不支持传输文件夹，请展开后选择文件", "info");
      return;
    }
    for (const it of items) {
      if (sourceSide === "local" && targetSide === "remote") {
        const localPath = joinLocalPath(localCwd, it.name);
        // 大小预检：超 100MB 客户端阻断，不发请求
        let size = 0;
        try {
          size = (await stat(localPath)).size;
        } catch {
          /* 取不到大小则放行，由后端兜底 */
        }
        if (size > LIMIT_BYTES) {
          await showModal(
            `「${it.name}」（${fmtBytes(size)}）超过 100MB 上传上限，已取消`,
            "info",
          );
          continue;
        }
        const exists = remoteEntries.some((e) => e.name === it.name);
        if (exists) {
          const ok = await showModal(`远程已存在「${it.name}」，是否覆盖？`);
          if (!ok) continue;
        }
        void upload(localPath, joinRemotePath(remoteCwd, it.name), exists);
      } else if (sourceSide === "remote" && targetSide === "local") {
        // 大小预检：远程条目带 size（SFTP ls），超 100MB 阻断
        const remoteSize =
          remoteEntries.find((e) => e.name === it.name)?.size ?? 0;
        if (remoteSize > LIMIT_BYTES) {
          await showModal(
            `「${it.name}」（${fmtBytes(remoteSize)}）超过 100MB 下载上限，已取消`,
            "info",
          );
          continue;
        }
        const exists = localEntries.some((e) => e.name === it.name);
        if (exists) {
          const ok = await showModal(`本地已存在「${it.name}」，是否覆盖？`);
          if (!ok) continue;
        }
        void download(
          joinRemotePath(remoteCwd, it.name),
          joinLocalPath(localCwd, it.name),
        );
      }
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <Icon name="sftp" size={14} />
        <span className="panel-title">SFTP 文件传输</span>
        <div className="panel-actions">
          {connectionId && (
            <button
              className="icon-btn"
              title="刷新本地和远程"
              disabled={localLoading || loading}
              onClick={() => {
                void Promise.all([refreshLocal(), refreshRemote()]);
              }}
            >
              <Icon name="refresh" size={13} />
            </button>
          )}
          {connectionId ? (
            <span className={styles.connTag} title={currentName}>
              <span className={styles.connDot} />
              {currentName}
            </span>
          ) : (
            <span className={styles.connHint}>未连接</span>
          )}
        </div>
      </div>

      <div className={`panel-body ${styles.body}`}>
        {!connectionId ? (
          <EmptyState
            icon="sftp"
            title="未选择连接"
            hint="在左侧服务器列表点击一台已连接的服务器"
          />
        ) : (
          <>
            <div className={styles.dual}>
              {/* 左：本地侧（tauri fs，仅桌面壳内可用） */}
              <div className={styles.localPane}>
                <DirListView
                  side="local"
                  title="本地"
                  crumbs={localCrumbsList}
                  entries={localEntries}
                  loading={localLoading}
                  error={localError}
                  onCrumbClick={(p) => void openLocalDir(p)}
                  onOpen={(e) => {
                    if (e.directory)
                      void openLocalDir(joinLocalPath(localCwd, e.name));
                  }}
                  onPickDir={async () => {
                    try {
                      const sel = await open({
                        directory: true,
                        multiple: false,
                      });
                      if (typeof sel === "string" && sel)
                        void openLocalDir(sel);
                    } catch {
                      /* 用户取消或桌面壳外不可用 */
                    }
                  }}
                  onDropItems={(src, items) => handleDrop("local", src, items)}
                  emptyHint="空文件夹"
                />
              </div>

              {/* 右：远程侧 */}
              <div className={styles.remotePane}>
                <DirListView
                  side="remote"
                  title="远程"
                  crumbs={crumbs}
                  entries={remoteEntries}
                  loading={loading}
                  error={error}
                  onCrumbClick={(p) => void openRemoteDir(p)}
                  onOpen={(e) => {
                    if (e.directory)
                      void openRemoteDir(joinRemotePath(remoteCwd, e.name));
                  }}
                  onDropItems={(src, items) => handleDrop("remote", src, items)}
                />
              </div>
            </div>

            {transfers.length > 0 && (
              <div className={styles.transfers}>
                {transfers.map((t) => (
                  <TransferTrack
                    key={t.id}
                    transfer={t}
                    onOpen={() =>
                      void openDownload(t.id, (localPath) =>
                        showModal(
                          `「${localPath}」可能执行代码。文件来自远程服务器，是否仍要打开？`,
                        ),
                      )
                    }
                    onClose={() => clearTransfer(t.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {dialog && (
        <ConfirmDialog
          message={dialog.message}
          kind={dialog.kind}
          onResolve={(ok) => {
            dialog.resolve(ok);
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}
