package com.johnny.domain.ssh.model.entity;

import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.Getter;
import org.apache.commons.lang3.StringUtils;

/**
 * SSH 连接高级配置实体。
 * <p>
 * 通过 {@link #applyDefaults()} 填充默认值（用户未指定时）；
 * 仅暴露 getter，写操作通过工厂方法完成。
 */
@Getter
public class SshConnectionConfigEntity {

    /** 默认连接超时（毫秒） */
    public static final int DEFAULT_CONNECT_TIMEOUT = 5000;
    /** 默认 keepalive 间隔（毫秒） */
    public static final int DEFAULT_KEEPALIVE_INTERVAL = 30000;
    /** 默认是否启用严格主机密钥检查 */
    public static final boolean DEFAULT_STRICT_HOST_KEY_CHECK = false;
    /** 默认是否启用压缩 */
    public static final boolean DEFAULT_COMPRESSION = false;

    private String connectionId;
    /** 连接超时（毫秒） */
    private Integer connectTimeout;
    /** keepalive 间隔（毫秒） */
    private Integer keepaliveInterval;
    /** 连接后执行的启动命令 */
    private String startupCommand;
    /** 是否启用严格主机密钥检查 */
    private boolean strictHostKeyCheck;
    /** 已知主机密钥列表 */
    private String knownHosts;
    /** 是否启用压缩 */
    private boolean compression;

    private SshConnectionConfigEntity() {
    }

    /**
     * 填充默认值（幂等）：用户未指定或非法的超时/间隔填默认值，空字符串归一化为 ""。
     * <p>
     * 当用户不指定高级配置时，调用本方法自动填充默认值。
     */
    public void applyDefaults() {
        if (connectTimeout == null || connectTimeout <= 0) {
            connectTimeout = DEFAULT_CONNECT_TIMEOUT;
        }
        if (keepaliveInterval == null || keepaliveInterval <= 0) {
            keepaliveInterval = DEFAULT_KEEPALIVE_INTERVAL;
        }
        if (StringUtils.isBlank(startupCommand)) {
            startupCommand = "";
        }
        if (StringUtils.isBlank(knownHosts)) {
            knownHosts = "";
        }
    }

    /**
     * 校验：超时与间隔若指定则不能为负。
     *
     * @throws AppException 校验失败
     */
    public void validate() {
        if (connectTimeout != null && connectTimeout < 0) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接超时不能为负");
        }
        if (keepaliveInterval != null && keepaliveInterval < 0) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "保活间隔不能为负");
        }
    }

    /**
     * 构建配置实体（仅装配，不校验、不填默认值；由调用方按需调用 {@link #validate()} / {@link #applyDefaults()}）。
     */
    public static SshConnectionConfigEntity create(String connectionId, Integer connectTimeout, Integer keepaliveInterval,
                                                   String startupCommand, boolean strictHostKeyCheck,
                                                   String knownHosts, boolean compression) {
        SshConnectionConfigEntity entity = new SshConnectionConfigEntity();
        entity.connectionId = connectionId;
        entity.connectTimeout = connectTimeout;
        entity.keepaliveInterval = keepaliveInterval;
        entity.startupCommand = startupCommand;
        entity.strictHostKeyCheck = strictHostKeyCheck;
        entity.knownHosts = knownHosts;
        entity.compression = compression;
        return entity;
    }

    /**
     * 从持久化数据还原。
     */
    public static SshConnectionConfigEntity restore(String connectionId, Integer connectTimeout, Integer keepaliveInterval,
                                                    String startupCommand, boolean strictHostKeyCheck,
                                                    String knownHosts, boolean compression) {
        return create(connectionId, connectTimeout, keepaliveInterval, startupCommand, strictHostKeyCheck, knownHosts, compression);
    }
}
