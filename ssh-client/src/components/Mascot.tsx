import styles from "./Mascot.module.css";

export type MascotMood = "thinking" | "happy" | "dead";

interface MascotProps {
  mood: MascotMood;
  /** 展示尺寸（px），内部以 110px 基准整体缩放；默认 110（启动门原尺寸） */
  size?: number;
}

/** 几何小吉祥物：等待时漂浮眨眼，就绪眯眼笑，失败翻白眼（✕✕）。
 *  产品唯一吉祥物形象，启动门（BootSplash）与会话提示横幅共用。 */
export default function Mascot({ mood, size = 110 }: MascotProps) {
  const moodClass =
    mood === "happy" ? styles.moodHappy : mood === "dead" ? styles.moodDead : "";
  return (
    <div
      className={`${styles.mascot} ${moodClass}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div className={styles.inner} style={{ transform: `scale(${size / 110})` }}>
        <div className={styles.halo} />
        <div className={styles.mascotBody}>
          <div className={styles.eyes}>
            <span className={styles.eye} />
            <span className={styles.eye} />
          </div>
          <div className={styles.mouth} />
        </div>
        <div className={styles.mascotShadow} />
      </div>
    </div>
  );
}
