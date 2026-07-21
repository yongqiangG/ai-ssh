package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 连接响应 DTO。
 * <p>
 * 聚合根（基础连接 + 高级配置）平铺为单对象，供查询/列表返回。包含 connectionId 与持久化状态。
 * <p>
 * 凭据只写不回显：password/privateKey 永不回传，编辑回填依赖 {@code passwordConfigured} 布尔
 * 与 {@code keyId} 引用（同 LlmConfig 的 apiKeyConfigured 模式）；留空提交表示不修改。
 */
@Data
public class SshConnectionResponseDTO {

    /** 连接唯一标识 */
    private String connectionId;
    private String name;
    private String host;
    private int port;
    private String username;
    /** PASSWORD / PUBLIC_KEY */
    private String authType;
    /** 是否已配置密码（密文永不回传；编辑时留空=保持不变） */
    private boolean passwordConfigured;
    /** 引用的密钥实体 keyId（PUBLIC_KEY 认证）；密钥名由前端从密钥列表关联 */
    private String keyId;
    /** 连接状态编码：0=未连接，1=已连接 */
    private int status;
    private String userId;

    /** 连接超时（毫秒） */
    private Integer connectTimeout;
    /** keepalive 间隔（毫秒） */
    private Integer keepaliveInterval;
    private String startupCommand;
    private String knownHosts;
    private boolean strictHostKeyCheck;
    private boolean compression;
}
