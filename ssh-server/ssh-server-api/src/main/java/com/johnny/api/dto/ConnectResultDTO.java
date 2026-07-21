package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 连接尝试结果 DTO（TOFU 主机指纹流程载体）。
 * <p>
 * {@code success=false} 且 {@code hostKeyStatus} 非空 = 被指纹校验拦下：
 * UNKNOWN 弹确认卡片；CHANGED 红色警告（疑似重装/中间人），需双重确认。
 * 用户确认后携 {@code knownHostLine} 调 accept-hostkey，再重新 connect。
 */
@Data
public class ConnectResultDTO {

    private boolean success;
    /** UNKNOWN / CHANGED；非指纹原因失败为 null */
    private String hostKeyStatus;
    private String host;
    /** 密钥算法，如 ssh-ed25519 */
    private String keyType;
    /** 服务器当前指纹（SHA256:base64） */
    private String fingerprintSha256;
    /** 已知旧指纹（仅 CHANGED） */
    private String oldFingerprintSha256;
    /** 确认后写入 known_hosts 的完整行 */
    private String knownHostLine;
    /** 非指纹原因失败的简述 */
    private String error;
}
