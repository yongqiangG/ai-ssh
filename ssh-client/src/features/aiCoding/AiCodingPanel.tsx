import styles from "./AiCodingPanel.module.css";

/**
 * AI Coding 整窗面板（骨架阶段）。
 *
 * 功能域独立（docs/situations/260815-ai-coding-panel.md）：不经 ssh-server，
 * 数据落本地 ~/.ai-ssh/coding/（Rust coding/ 模块），与 SSH 运维链路零共享。
 * 后续阶段在此挂载 nezha 迁移来的 ProjectRail + TaskPanel + 运行视图。
 */
export default function AiCodingPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.placeholder}>
        <span className={styles.icon}>✦</span>
        <h1 className={styles.title}>AI Coding</h1>
        <p className={styles.hint}>
          项目任务管理与 Claude / Codex 终端即将就绪（骨架阶段）
        </p>
      </div>
    </div>
  );
}
