package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 密钥响应 DTO。
 * <p>凭据只写不回显：privateKey/passphrase 永不回传，编辑回填依赖 {@code passphraseConfigured} 布尔。
 */
@Data
public class SshKeyDTO {

    /** 密钥唯一标识 */
    private String keyId;
    /** 密钥显示名 */
    private String name;
    /** 是否设置了私钥口令（密文永不回传；编辑时留空=保持不变） */
    private boolean passphraseConfigured;
}
