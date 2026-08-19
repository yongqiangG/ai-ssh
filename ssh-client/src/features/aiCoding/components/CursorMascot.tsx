import type React from "react";
import styles from "./CursorMascot.module.css";

export type MascotState = "relaxed" | "eager" | "reacting";
export type MascotVariant = "idle" | "wave";

/**
 * 小橙蟹——aiCoding 统一吉祥物(260819,替代 claude/codex GIF;形象参考用户手稿
 * crab.html:墨描边卡通 + Claude 陶土橙,腿×4/钳×2/眼柄丘/腮红/奶油笑嘴)。
 *
 * - 品牌角色配色硬编码(与主题令牌解耦),不编码 agent 身份——agent 归属仍由
 *   各处 claude/chatgpt svg 承担;腿与钳臂在暗底上用橙色描线保证可见。
 * - variant="idle":bob 起伏 + 双钳交替轻摆 + 眨眼;state 表达待机/蓄势
 *   (输入有内容)/瞬时反应,由消费方驱动(reacting 为一次性,父组件限时置位)。
 * - variant="wave":配合外层 rail-mascot-wave 位移(探头→挥钳→缩回),
 *   碎步/挥钳/闭眼道别同为 3.6s,与外层同挂载(key=nonce)故时序同步。
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
  const eyesClass = isWave
    ? styles.eyesWave
    : [styles.eyeScale, eyeScaleClass].filter(Boolean).join(" ");

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, ...style }}
    >
      <g className={[styles.lean, leanClass].filter(Boolean).join(" ")}>
        <g className={isWave ? undefined : styles.bob}>
          <g className={isWave ? styles.walkA : undefined}>
            <path className={styles.leg} d="M18 40 C14.5 43 12.5 46 11.5 49.5" />
            <path className={styles.leg} d="M42 42 C44 45 45 47.5 45.5 50" />
          </g>
          <g className={isWave ? styles.walkB : undefined}>
            <path className={styles.leg} d="M22 42 C20 45 19 47.5 18.5 50" />
            <path className={styles.leg} d="M46 40 C49.5 43 51.5 46 52.5 49.5" />
          </g>
          <g className={styles.clawL}>
            <path className={styles.clawArm} d="M14.5 30 C11.5 27 9.5 23.5 8.5 19.5" />
            <circle className={styles.clawBody} cx="7.4" cy="14.8" r="4.4" />
            <path className={styles.clawNotch} d="M5.6 11.4 L7.6 13.6 L5.1 15.2" />
          </g>
          <path
            className={styles.stalk}
            d="M20.5 16 C20.5 7 24 4 27 4 C30 4 33.5 7 33.5 16 Z"
          />
          <path
            className={styles.stalk}
            d="M30.5 16 C30.5 7 34 4 37 4 C40 4 43.5 7 43.5 16 Z"
          />
          <path
            className={styles.shell}
            d="M14 32 C14 19 22 12 32 12 C42 12 50 19 50 32 C50 40 42 44 32 44 C22 44 14 40 14 32 Z"
          />
          <path
            className={styles.shellHi}
            d="M19.5 26 C21 18.5 26 14.5 32 14.5 C38 14.5 43 18.5 44.5 26"
          />
          <g className={eyesClass}>
            <ellipse className={styles.eye} cx="27" cy="10" rx="2.1" ry="3.1" />
            <ellipse className={styles.eye} cx="37" cy="10" rx="2.1" ry="3.1" />
          </g>
          <circle className={styles.cheek} cx="21" cy="29" r="2.8" />
          <circle className={styles.cheek} cx="43" cy="29" r="2.8" />
          <path
            className={styles.mouth}
            d="M25.5 27.5 C27 33.5 29 35.5 32 35.5 C35 35.5 37 33.5 38.5 27.5 Q32 30.2 25.5 27.5 Z"
          />
          <path
            className={styles.tongue}
            d="M28 33.8 C29.3 32.2 30.6 31.6 32 31.6 C33.4 31.6 34.7 32.2 36 33.8 C34.7 34.8 33.4 35.2 32 35.2 C30.6 35.2 29.3 34.8 28 33.8 Z"
          />
          <g className={isWave ? styles.clawRWave : styles.clawR}>
            <path className={styles.clawArm} d="M49.5 30 C52.5 27 54.5 23.5 55.5 19.5" />
            <circle className={styles.clawBody} cx="56.6" cy="14.8" r="4.9" />
            <path className={styles.clawNotch} d="M58.4 10.9 L56.4 13.1 L58.9 14.7" />
          </g>
        </g>
      </g>
    </svg>
  );
}
