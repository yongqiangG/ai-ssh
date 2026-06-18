import Icon from "./Icon";
import styles from "./TopBar.module.css";

export default function TopBar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <Icon name="terminal" size={16} />
        <span className={styles.title}>AI SSH Client</span>
        <span className={styles.badge}>v0.1.0</span>
      </div>
      <div className={styles.right}>
        <span className={styles.hint}>前端预览 · SSH / AI 已在边界处打桩</span>
      </div>
    </header>
  );
}
