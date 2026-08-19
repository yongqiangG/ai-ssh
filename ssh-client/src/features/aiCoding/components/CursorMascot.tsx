import type React from "react";
import styles from "./CursorMascot.module.css";

export type MascotState = "relaxed" | "eager" | "reacting";
export type MascotVariant = "idle" | "wave";

/**
 * 终端光标生物——aiCoding 统一吉祥物(260819 grill 决议,替代 claude/codex GIF)。
 *
 * - 配色走主题令牌(身体 --text-primary、眼睛 --accent),不编码 agent 身份;
 *   agent 归属仍由各处 claude/chatgpt svg 承担。
 * - variant="idle":眨眼 + 光标呼吸;state 表达待机/蓄势(输入有内容)/瞬时反应,
 *   由消费方驱动(reacting 为一次性,父组件限时置位)。
 * - variant="wave":配合外层 rail-mascot-wave 位移(探头→挥手→缩回),
 *   手臂挥动与闭眼道别同为 3.6s,与外层同挂载(key=nonce)故时序同步。
 */
export function CursorMascot({
  size = 112,
  variant = "idle",
  state = "relaxed",
  className,
  style,
}: {
  size?: number | string;
  variant?: MascotVariant;
  state?: MascotState;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isWave = variant === "wave";
  const leanClass =
    state === "reacting" ? styles.leanReacting : state === "eager" ? styles.leanEager : undefined;
  const eyeScaleClass =
    state === "reacting" ? styles.eyesReacting : state === "eager" ? styles.eyesEager : undefined;

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, ...style }}
    >
      <g className={[styles.lean, leanClass].filter(Boolean).join(" ")}>
        <rect
          className={isWave ? styles.body : `${styles.body} ${styles.bodyIdle}`}
          x="9"
          y="7"
          width="42"
          height="44"
          rx="12"
        />
        <rect
          className={isWave ? styles.armWave : styles.arm}
          x="49"
          y="20"
          width="7.5"
          height="19"
          rx="3.75"
        />
        <g className={eyeScaleClass}>
          <g className={isWave ? styles.eyesWave : styles.eyesIdle}>
            <circle className={styles.eye} cx="22.5" cy="26" r="4.4" />
            <circle className={styles.eye} cx="37.5" cy="26" r="4.4" />
            <circle className={styles.glint} cx="24.1" cy="24.5" r="1.4" />
            <circle className={styles.glint} cx="39.1" cy="24.5" r="1.4" />
          </g>
        </g>
        <path className={styles.smile} d="M24.5 37 Q 30 42.5 35.5 37" />
      </g>
    </svg>
  );
}
