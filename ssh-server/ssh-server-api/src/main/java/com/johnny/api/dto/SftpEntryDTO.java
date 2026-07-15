package com.johnny.api.dto;

import lombok.Data;

/**
 * SFTP 目录条目响应 DTO，对应领域值对象 {@code SftpEntry}。
 */
@Data
public class SftpEntryDTO {

    /** 条目名（不含路径） */
    private String name;
    /** 是否目录 */
    private boolean directory;
    /** 字节数（目录通常为 0） */
    private long size;
    /** 最后修改时间（毫秒级时间戳） */
    private long lastModified;
}
