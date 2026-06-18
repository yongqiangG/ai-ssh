/**
 * 生成唯一 id。优先使用原生 crypto.randomUUID，
 * 不可用时回退到时间戳 + 随机串（保证可测试环境也能运行）。
 */
export function createId(prefix = ""): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${rand}` : rand;
}
