/**
 * 终端输出报错检测（F5 报错诊断）：对轮询增量输出做行级正则匹配，识别常见失败信号。
 *
 * 决议为输出匹配版（不做 PROMPT_COMMAND/PS1 注入取 exit code）；
 * 规则求高置信度而非高召回——漏报只是少一次提示，误报则是打扰；
 * 残余误报（如 cat 一份含 ERROR 的日志）由同类防噪 + 全局开关兜底。
 */

/** 去除 ANSI 转义序列（OSC / CSI / 单字符控制），检测在纯文本上进行 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "");
}

/** 常见报错模式（对 trim 后的单行匹配，`^` 即行首） */
const ERROR_PATTERNS = new RegExp(
  [
    "command not found",
    "no such file or directory",
    "permission denied",
    "operation not permitted",
    "connection (?:refused|timed out|reset)",
    "segmentation fault",
    "cannot allocate memory|out of memory",
    "traceback \\(most recent call last\\)",
    "npm err!",
    "curl: \\(\\d+\\)",
    "error response from daemon",
    // 行首的 error/fatal/panic 词（mysql「ERROR 1045…」、go「panic: …」、git「fatal: …」）
    "^(?:error|err|fatal|panic)\\b",
    // 「XxxError: / SomeException: / ERROR[…」形态（python ValueError、java 异常类、日志级别）
    "[\\w.]*(?:error|exception)\\s*[:\\[]",
    "\\bfatal\\s*[:\\[]",
  ].join("|"),
  "i"
);

/** 在增量输出块中找第一个命中的报错行（去 ANSI、trim 后返回）；无命中返回 null */
export function findErrorLine(chunk: string): string | null {
  if (!chunk) return null;
  for (const raw of stripAnsi(chunk).split(/\r?\n/)) {
    const line = raw.trim();
    if (line && ERROR_PATTERNS.test(line)) return line;
  }
  return null;
}

/**
 * 同类报错防噪 key：数字归一（端口/PID/IP 变了仍算同类）、压空白、截断。
 * 「同类报错短时间内不重复弹」按此 key 判定。
 */
export function errorKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").slice(0, 120);
}

/**
 * 宽松的「像报错吗」判定（F1 Tab 补全默认提问的二选一文案用）。
 * 与 findErrorLine 的分工：那边判「输出流出现失败信号」求高置信度（触发弹泡），
 * 这边判「用户引用的文本像不像报错」宽松即可（只影响默认文案措辞）。
 * 统一住在本文件，避免两套 error 规则各自漂移。
 */
export const LOOSE_ERROR_HINT =
  /error|fail|exception|denied|refused|not found|panic|fatal|traceback|无法|失败|错误/i;
