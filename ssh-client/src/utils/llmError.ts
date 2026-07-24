/**
 * LLM 调用失败的前端侧辅助：
 * - 可重试判定（决定错误条是否显示「重试」按钮）
 * - fetch 层错误兜底人话（后端 error 事件带 code 的场景人话已由后端给出；
 *   这里只处理拿不到 code 的浏览器层失败——连不上后端 / 流中断 / HTTP 状态错）
 */

/** 不可重试：AUTH/BAD_CONFIG 该去改设置；SESSION_EXPIRED 会话已归档无处重试 */
const NON_RETRYABLE = new Set(["LLM_AUTH_FAILED", "LLM_BAD_CONFIG", "AI_SESSION_EXPIRED"]);

export function isRetryableLlmError(code: string | undefined): boolean {
  return !code || !NON_RETRYABLE.has(code);
}

export function humanizeClientError(err: string): string {
  const lower = err.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "无法连接后端服务，请确认应用状态后重试";
  }
  if (lower.includes("network") || lower.includes("载入") || lower.includes("aborted")) {
    return "网络请求中断，请重试";
  }
  if (/^http 5\d\d/.test(lower)) {
    return "后端服务暂时不可用，请稍后重试";
  }
  if (/^http 4\d\d/.test(lower)) {
    return `请求被后端拒绝（${err}），请重试；持续失败请重启应用`;
  }
  return err;
}
