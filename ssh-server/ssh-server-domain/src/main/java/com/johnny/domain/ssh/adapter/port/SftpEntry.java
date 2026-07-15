package com.johnny.domain.ssh.adapter.port;

/**
 * SFTP 目录条目（值对象）。
 * <p>由 {@link ISftpPort#list} 返回，UI 双面板列表与 LLM 工具 {@code SftpAdkTool} 共享消费。
 * 字段采用 public 风格，与同包 {@link ExecResult} 等 POJO 一致。
 */
public class SftpEntry {
    /** 条目名（不含路径） */
    public String name;
    /** 是否目录 */
    public boolean directory;
    /** 字节数（目录通常为 0） */
    public long size;
    /** 最后修改时间（毫秒级时间戳） */
    public long lastModified;
}
