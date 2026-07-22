/**
 * 启动进度预估：没有真实进度可拿（Spring 启动无法向前端上报），
 * 用「上次启动耗时」做预估基准，ease-out 曲线走到 90% 悬停等待就绪冲刺。
 * 决议见 docs/situations/260722-boot-splash-and-startup-speed.md Q5。
 */

const STORAGE_KEY = "ai-ssh:lastBootMs";

export const DEFAULT_EXPECTED_BOOT_MS = 8000;
/** 历史耗时的合理区间：过小会导致进度瞬跳，过大会让进度几乎不动 */
const MIN_EXPECTED_MS = 1500;
const MAX_EXPECTED_MS = 60000;
/** 悬停封顶：剩余 10% 留给就绪瞬间的冲刺动画 */
const CAP = 0.9;
/** 衰减系数：elapsed=expected 时约 1-e^-2.2≈88.9%，正好贴近悬停带 */
const DECAY = 2.2;

/** 预估进度（0~0.9）：前段快后段慢的 ease-out，给人「一直在推进」的信号 */
export function estimateProgress(elapsedMs: number, expectedMs: number): number {
  const expected =
    Number.isFinite(expectedMs) && expectedMs > 0
      ? expectedMs
      : DEFAULT_EXPECTED_BOOT_MS;
  if (!(elapsedMs > 0)) return 0;
  const p = 1 - Math.exp((-DECAY * elapsedMs) / expected);
  return Math.min(p, CAP);
}

/** 读取上次启动耗时作为本次预估；无记录或脏数据用默认 8s */
export function readExpectedBootMs(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null) return DEFAULT_EXPECTED_BOOT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_EXPECTED_BOOT_MS;
  return Math.min(Math.max(value, MIN_EXPECTED_MS), MAX_EXPECTED_MS);
}

/** 就绪后记录本次真实耗时，作为下次启动的预估基准 */
export function saveBootDuration(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  localStorage.setItem(STORAGE_KEY, String(Math.round(ms)));
}
