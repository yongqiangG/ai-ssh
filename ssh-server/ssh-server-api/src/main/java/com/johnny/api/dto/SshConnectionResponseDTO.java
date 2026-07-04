package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 连接响应 DTO。
 * <p>
 * 聚合根（基础连接 + 高级配置）平铺为单对象，供查询/列表返回。包含 connectionId 与持久化状态。
 * <p>
 * 注意：password/privateKey 以明文返回以支持编辑回填（与领域当前明文流转一致）；本地工具可接受，
 * 后续可改为脱敏并在编辑时要求重填。
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
    private String password;
    private String privateKey;
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
