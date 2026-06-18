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
      <Icon name={icon} size={28} className={styles.icon} />
      <div className={styles.title}>{title}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
