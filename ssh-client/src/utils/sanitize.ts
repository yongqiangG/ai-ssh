/**
 * 终端上下文脱敏（F3 决议）：发送给模型前把明显凭据模式打码。
 *
 * 设计立场：single 版的模型端点是用户自配的第三方/中转站，终端上下文一键出境，
 * 产品兜住最明显的泄漏面；被掩码成 *** 的内容本来就不该给模型。
 * 规则求「明显凭据」的高召回，不追求零误杀（误杀的也只是模型少看一个值）。
 */

const MASK = "***";

/** 键值对形态的敏感键（PASSWORD=xxx / secret: xxx / export TOKEN=xxx …） */
const KV_KEY = /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth|credential)[a-z0-9_-]*)(\s*[=:]\s*)(["']?)([^\s"']{4,})(\3)/gi;

/** 认证 scheme 关键词不是秘密本身（Authorization: Bearer xxx 的值由 BEARER 规则处理） */
const AUTH_SCHEME = /^(?:bearer|basic|digest|negotiate|ntlm)$/i;

/** PEM 私钥块（含 BEGIN/END 之间全部内容） */
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/** AWS AccessKeyId（AKIA/ASIA 开头 20 位） */
const AWS_KEY = /\b(A(?:KIA|SIA)[0-9A-Z]{16})\b/g;

/** JWT（三段 base64url） */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** Bearer/Basic 等认证头（先于 KV_KEY 执行，避免 KV 规则把 scheme 词当值掩码后漏掉真 token） */
const BEARER = /\b((?:Bearer|Basic|Digest)\s+)[A-Za-z0-9._~+/=-]{16,}/gi;

/** 独立长 base64/hex 串（≥40 字符，常见于密钥材料；避开 URL 路径） */
const LONG_SECRET = /(?<![/\w])[A-Za-z0-9+/]{40,}={0,2}(?![/\w])/g;

/** 恰好 40 位纯 hex 是 git sha1 形态（运维终端里极常见），不视为秘密——避免 git log 进上下文时 hash 全被打码 */
const GIT_SHA1 = /^[0-9a-f]{40}$/i;

/**
 * 对终端文本做脱敏；返回打码后的文本。
 */
export function sanitizeTerminalContext(text: string): string {
  if (!text) return text;
  return text
    .replace(PEM_BLOCK, `-----BEGIN PRIVATE KEY-----${MASK}-----END PRIVATE KEY-----`)
    .replace(BEARER, (_m, prefix: string) => `${prefix}${MASK}`)
    .replace(KV_KEY, (m, key: string, sep: string, q: string, value: string) =>
      AUTH_SCHEME.test(value) ? m : `${key}${sep}${q}${MASK}${q}`
    )
    .replace(AWS_KEY, MASK)
    .replace(JWT, MASK)
    .replace(LONG_SECRET, (m) => (GIT_SHA1.test(m) ? m : MASK));
}
