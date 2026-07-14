package com.johnny.domain.ssh.adapter.port;

/**
 * exec 通道单次命令执行的结构化结果（Q1：独立 exec 通道）。
 * <p>工具层 {@code SshExecuteAdkTool} 据此组装返回给 LLM 的 8 字段 Map。
 * 字段采用 public 风格，与 {@link ISshSessionPort.OpenResult} 等同包 POJO 一致。
 */
public class ExecResult {
    /** 标准输出（已截断到 {@code EXEC_STREAM_LIMIT} 字节） */
    public String stdout;
    /** 标准错误（已截断） */
    public String stderr;
    /** 真实退出码；通道异常/超时未拿到时为 -1 */
    public int exitCode = -1;
    /** 是否超时强断 */
    public boolean timedOut;
    /** stdout 是否被截断 */
    public boolean stdoutTruncated;
    /** stderr 是否被截断 */
    public boolean stderrTruncated;
    /** stdout 截断前原始字节数（供 LLM 提示输出体量） */
    public int stdoutOriginalBytes;
    /** stderr 截断前原始字节数 */
    public int stderrOriginalBytes;
}
