package com.johnny.domain.ssh.model.entity;

import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.Getter;
import org.apache.commons.lang3.StringUtils;

/**
 * SSH 连接基础配置实体（富领域模型）。
 * <p>
 * 仅暴露 getter，所有写操作通过工厂方法 {@link #create} 完成校验与装配；
 * 已落库数据通过 {@link #restore} 还原（跳过校验）。
 * <p>
 * 连接状态是运行时事实（内存中的 JSch 会话），不属于本实体，也不持久化——
 * 查询实时状态走 {@code ISshSessionPort.isConnected}。
 */
@Getter
public class SshConnectionEntity {

    /** 连接名称最大长度（与 ssh_connection.name varchar(64) 对齐） */
    private static final int NAME_MAX_LENGTH = 64;

    private String connectionId;
    private String name;
    private String host;
    private int port;
    private String username;
    private AuthTypeEnum authType;
    /** 明文密码（领域内流转，落库前由仓储加密） */
    private String password;
    /** 明文 SSH 私钥（PEM 格式）；历史内嵌模式遗留，新数据一律走 {@link #keyId} 引用密钥实体 */
    private String privateKey;
    /** 引用的密钥实体 keyId（PUBLIC_KEY 认证）；密码认证为 null */
    private String keyId;
    private String userId;

    private SshConnectionEntity() {
    }

    /**
     * 领域校验：连接名称、主机地址、端口号、用户名及认证字段一致性。
     *
     * @throws AppException 任一校验失败
     */
    public static void validate(String name, String host, int port, String username,
                                AuthTypeEnum authType, String password, String privateKey, String keyId) {
        if (StringUtils.isBlank(name)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接名称不能为空");
        }
        if (name.length() > NAME_MAX_LENGTH) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接名称长度不能超过 " + NAME_MAX_LENGTH);
        }
        if (StringUtils.isBlank(host)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "主机地址不能为空");
        }
        if (port < 1 || port > 65535) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "端口号非法: " + port);
        }
        if (StringUtils.isBlank(username)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "用户名不能为空");
        }
        if (authType == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "认证类型不能为空");
        }
        if (authType == AuthTypeEnum.PASSWORD && StringUtils.isBlank(password)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "密码认证方式下密码不能为空");
        }
        // 公钥认证：新数据走 keyId 引用密钥实体；privateKey 仅为历史内嵌数据的兼容读路径
        if (authType == AuthTypeEnum.PUBLIC_KEY && StringUtils.isBlank(keyId) && StringUtils.isBlank(privateKey)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "公钥认证方式下必须选择密钥");
        }
    }

    /**
     * 新建连接：先校验再装配。
     *
     * @throws AppException 校验失败
     */
    public static SshConnectionEntity create(String connectionId, String name, String host, int port,
                                             String username, AuthTypeEnum authType, String password,
                                             String privateKey, String keyId, String userId) {
        validate(name, host, port, username, authType, password, privateKey, keyId);
        SshConnectionEntity entity = new SshConnectionEntity();
        entity.connectionId = connectionId;
        entity.name = name;
        entity.host = host;
        entity.port = port;
        entity.username = username;
        entity.authType = authType;
        entity.password = password;
        entity.privateKey = privateKey;
        entity.keyId = keyId;
        entity.userId = userId;
        return entity;
    }

    /**
     * 从持久化数据还原（跳过校验，信任已落库数据）。
     */
    public static SshConnectionEntity restore(String connectionId, String name, String host, int port,
                                              String username, AuthTypeEnum authType, String password,
                                              String privateKey, String keyId, String userId) {
        SshConnectionEntity entity = new SshConnectionEntity();
        entity.connectionId = connectionId;
        entity.name = name;
        entity.host = host;
        entity.port = port;
        entity.username = username;
        entity.authType = authType;
        entity.password = password;
        entity.privateKey = privateKey;
        entity.keyId = keyId;
        entity.userId = userId;
        return entity;
    }
}
