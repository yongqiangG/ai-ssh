import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export default function EmptyState({
  icon = "server",
  title,
  hint,
  action,
}: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      {/* 氛围光斑：纯装饰，置于内容层之下，reduced-motion 下静止 */}
      <span className={styles.blobA} aria-hidden="true" />
      <span className={styles.blobB} aria-hidden="true" />
      <div className={styles.iconWrap}>
        <Icon name={icon} size={24} className={styles.icon} />
      </div>
      <div className={styles.title}>{title}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
