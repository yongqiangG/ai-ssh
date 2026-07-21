package com.johnny.domain.ssh.model.aggregate;

import com.johnny.domain.ssh.model.entity.SshConnectionConfigEntity;
import com.johnny.domain.ssh.model.entity.SshConnectionEntity;
import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import lombok.Getter;

import java.util.UUID;

/**
 * SSH 连接聚合根。
 * <p>
 * 持有基础连接实体 {@link SshConnectionEntity} 与高级配置实体 {@link SshConnectionConfigEntity}，
 * 二者共享同一 connectionId 生命周期，由聚合根保证强一致性。
 */
@Getter
public class SshConnectionAggregate {

    private final SshConnectionEntity connection;
    private final SshConnectionConfigEntity config;

    private SshConnectionAggregate(SshConnectionEntity connection, SshConnectionConfigEntity config) {
        this.connection = connection;
        this.config = config;
    }

    /**
     * 新建聚合根：校验基础字段 → 生成 connectionId → 构建基础实体 → 构建并校验/填充默认值的高级配置。
     * <p>
     * 注意：本方法不处理加密，密码/私钥在领域内保持明文，加密发生在仓储落库边界。
     *
     * @return 已完成校验与默认值填充的聚合根
     * @throws AppException 任一校验失败
     */
    public static SshConnectionAggregate create(String name, String host, int port, String username,
                                                AuthTypeEnum authType, String password, String privateKey,
                                                String keyId, String userId,
                                                Integer connectTimeout, Integer keepaliveInterval,
                                                String startupCommand, boolean strictHostKeyCheck,
                                                String knownHosts, boolean compression) {
        SshConnectionEntity.validate(name, host, port, username, authType, password, privateKey, keyId);

        String connectionId = UUID.randomUUID().toString().replace("-", "");

        SshConnectionEntity connection = SshConnectionEntity.create(
                connectionId, name, host, port, username, authType, password, privateKey, keyId, userId);

        SshConnectionConfigEntity config = SshConnectionConfigEntity.create(
                connectionId, connectTimeout, keepaliveInterval, startupCommand, strictHostKeyCheck, knownHosts, compression);
        config.validate();
        config.applyDefaults();

        return new SshConnectionAggregate(connection, config);
    }

    /**
     * 从持久化数据还原聚合根（仓储使用，跳过校验）。
     */
    public static SshConnectionAggregate restore(SshConnectionEntity connection, SshConnectionConfigEntity config) {
        return new SshConnectionAggregate(connection, config);
    }

    /** 便捷方法：获取连接唯一标识 */
    public String getConnectionId() {
        return connection.getConnectionId();
    }
}
