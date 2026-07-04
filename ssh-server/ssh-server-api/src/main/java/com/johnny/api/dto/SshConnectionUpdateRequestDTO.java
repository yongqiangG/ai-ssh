package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 连接更新请求 DTO。
 * <p>
 * 对齐领域 {@code ISshConnectionService.UpdateCmd}：包装类型字段为 {@code null} 表示「不修改」，
 * 因此 {@code port} 用 {@link Integer}、开关字段用 {@link Boolean}、{@code authType} 可空，
 * 与创建 DTO 的语义区别在此。
 */
@Data
public class SshConnectionUpdateRequestDTO {

    private String name;
    private String host;
    /** null 表示不修改 */
    private Integer port;
    private String username;
    /** null 表示不修改；PASSWORD / PUBLIC_KEY */
    private String authType;
    /** null 表示沿用旧明文 */
    private String password;
    /** null 表示沿用旧明文 */
    private String privateKey;

    private Integer connectTimeout;
    private Integer keepaliveInterval;
    private String startupCommand;
    private String knownHosts;
    /** null 表示不修改 */
    private Boolean strictHostKeyCheck;
    /** null 表示不修改 */
    private Boolean compression;
}
