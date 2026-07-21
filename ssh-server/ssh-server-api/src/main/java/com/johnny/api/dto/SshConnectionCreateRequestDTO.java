package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 连接创建请求 DTO。
 * <p>
 * 字段对齐领域 {@code ISshConnectionService.CreateCmd}；认证类型取字符串 {@code "PASSWORD"/"PUBLIC_KEY"}，
 * 与 {@code AuthTypeEnum.code} 一致。userId 不在 DTO 中，由请求头 {@code X-User-Id} 注入。
 */
@Data
public class SshConnectionCreateRequestDTO {

    /** 连接名称（必填，最长 64） */
    private String name;
    /** 主机地址（必填） */
    private String host;
    /** 端口（必填，1-65535） */
    private int port;
    /** 用户名（必填） */
    private String username;
    /** 认证类型：PASSWORD / PUBLIC_KEY */
    private String authType;
    /** 密码（PASSWORD 认证下必填） */
    private String password;
    /** 引用的密钥 keyId（PUBLIC_KEY 认证下必填；私钥内容经密钥接口管理，不随连接提交） */
    private String keyId;

    /** 连接超时（毫秒），可选 */
    private Integer connectTimeout;
    /** keepalive 间隔（毫秒），可选 */
    private Integer keepaliveInterval;
    /** 启动命令，可选 */
    private String startupCommand;
    /** 已知主机密钥，可选 */
    private String knownHosts;
    /** 是否启用严格主机密钥检查，可选 */
    private boolean strictHostKeyCheck;
    /** 是否启用压缩，可选 */
    private boolean compression;
}
