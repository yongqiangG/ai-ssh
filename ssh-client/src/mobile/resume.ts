// 恢复任务的可测纯逻辑（260825）：状态门槛与 sessionId 取值和桌面恢复
// 按钮一致（done/failed/cancelled/interrupted；detached 需先杀孤儿进程，
// 一期不开放，回桌面处理——决议见 docs/situations/260825-mobile-resume-task.md）。
import type { Task } from "./api";

export const RESUMABLE_STATUSES = new Set(["done", "failed", "cancelled", "interrupted"]);

/** 当前 agent 对应的会话 id（无则 null，恢复按钮不可用）。 */
export function resumeSessionId(task: Task): string | null {
  const id = task.agent === "codex" ? task.codexSessionId : task.claudeSessionId;
  return id ?? null;
}

/** 状态可恢复且会话 id 存在。status 缺省用 task.status；显式传入用实时
 * WS 状态（REST 数据可能滞后于任务状态帧）。 */
export function isTaskResumable(task: Task, status?: string): boolean {
  const s = status ?? task.status;
  return RESUMABLE_STATUSES.has(s) && resumeSessionId(task) !== null;
}
