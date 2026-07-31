import Icon from "./Icon";
import type { TransferItem } from "../stores/sftpStore";
import styles from "./TransferTrack.module.css";

/**
 * 单个传输项的「角色跑动」进度条（AI 风格动效）。
 *
 * - 轨道上一个小机器人角色，left = 进度%；running 时上下颠簸（bob）模拟跑动。
 * - 小文件进度秒到 100% → 角色快速到终点。
 * - done：角色欢呼跳跃（cheer）+ 绿色 + 撒花粒子。
 * - error：角色摔倒旋转（trip）+ 红色 + 冒烟。
 *
 * 动画全用 transform/opacity（transform-performance），prefers-reduced-motion 下降级为静止。
 */
export default function TransferTrack({
  transfer,
  onOpen,
  onClose,
}: {
  transfer: TransferItem;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { name, progress, status, direction, openState, openError } = transfer;
  const pct = Math.round(progress * 100);
  const canOpen = direction === "download" && status === "done";
  const hasOpened = openState === "opened";
  const opening = openState === "opening";

  return (
    <div className={styles.item}>
      <div className={styles.row}>
        <span
          className={`${styles.dir} ${direction === "upload" ? styles.up : styles.down}`}
          title={direction === "upload" ? "上传" : "下载"}
        >
          {direction === "upload" ? "↑" : "↓"}
        </span>
        <span className={styles.name} title={name}>
          {name}
        </span>

        <div className={`${styles.track} ${styles[status]}`}>
          <div
            className={styles.fill}
            style={{ transform: `scaleX(${progress})` }}
          />
          <div
            className={`${styles.runner} ${styles[status]}`}
            style={{ left: pct + "%" }}
          >
            <svg
              className={styles.runnerSvg}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 2v3" />
              <circle cx="12" cy="4.2" r="1.1" />
              <rect x="5" y="6" width="14" height="11" rx="4" />
              <circle
                cx="9.5"
                cy="11"
                r="1.3"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="14.5"
                cy="11"
                r="1.3"
                fill="currentColor"
                stroke="none"
              />
              <path d="M9.5 14.5h5" />
            </svg>
            {status === "done" && (
              <span className={styles.confetti} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
          {status === "error" && (
            <span className={styles.smoke} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>

        <span className={`${styles.status} ${styles[status]}`}>
          {status === "running"
            ? pct + "%"
            : status === "done"
              ? "完成"
              : "失败"}
        </span>

        {canOpen && (
          <button
            type="button"
            className={styles.openButton}
            title={transfer.localPath}
            aria-label={`${hasOpened ? "已打开" : "打开"} ${name}`}
            disabled={opening || hasOpened}
            onClick={onOpen}
          >
            <Icon name={hasOpened ? "check" : "openFile"} size={12} />
            {hasOpened ? "已打开" : "打开"}
          </button>
        )}

        {status !== "running" && (
          <button className="icon-btn" title="移除" onClick={onClose}>
            <Icon name="close" size={11} />
          </button>
        )}
      </div>
      {openError && (
        <div className={styles.openError} role="alert" title={openError}>
          {openError}
        </div>
      )}
    </div>
  );
}
