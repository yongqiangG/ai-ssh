package com.johnny.infrastructure.adapter.repository;

import com.johnny.domain.ssh.adapter.port.ISecretCipher;
import com.johnny.domain.ssh.adapter.repository.ISshConnectionRepository;
import com.johnny.domain.ssh.model.aggregate.SshConnectionAggregate;
import com.johnny.domain.ssh.model.entity.SshConnectionConfigEntity;
import com.johnny.domain.ssh.model.entity.SshConnectionEntity;
import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import com.johnny.infrastructure.dao.ISshConnectionConfigDao;
import com.johnny.infrastructure.dao.ISshConnectionDao;
import com.johnny.infrastructure.dao.po.SshConnectionConfigPO;
import com.johnny.infrastructure.dao.po.SshConnectionPO;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * SSH 连接仓储实现（依赖倒置：实现领域层接口）。
 * <p>
 * 聚合根 ↔ 双 PO 转换；password 与 privateKey 在落库前加密、读取时解密。
 */
@Repository
public class SshConnectionRepository implements ISshConnectionRepository {

    private final ISshConnectionDao connectionDao;
    private final ISshConnectionConfigDao configDao;
    private final ISecretCipher cipher;

    public SshConnectionRepository(ISshConnectionDao connectionDao,
                                   ISshConnectionConfigDao configDao,
                                   ISecretCipher cipher) {
        this.connectionDao = connectionDao;
        this.configDao = configDao;
        this.cipher = cipher;
    }

    @Override
    public void save(SshConnectionAggregate aggregate) {
        connectionDao.insert(toConnectionPO(aggregate.getConnection()));
        configDao.insert(toConfigPO(aggregate.getConfig()));
    }

    @Override
    public void update(SshConnectionAggregate aggregate) {
        connectionDao.update(toConnectionPO(aggregate.getConnection()));
        // 高级配置 upsert：存在则更新，不存在则插入
        if (configDao.queryByConnectionId(aggregate.getConnectionId()) == null) {
            configDao.insert(toConfigPO(aggregate.getConfig()));
        } else {
            configDao.update(toConfigPO(aggregate.getConfig()));
        }
    }

    @Override
    public SshConnectionAggregate queryByConnectionId(String connectionId) {
        SshConnectionPO po = connectionDao.queryByConnectionId(connectionId);
        if (po == null) {
            return null;
        }
        SshConnectionConfigPO cpo = configDao.queryByConnectionId(connectionId);
        // 容错：旧数据可能没有高级配置行，回退到默认配置
        SshConnectionConfigEntity config = cpo == null ? defaultConfig(connectionId) : toConfigEntity(cpo);
        return SshConnectionAggregate.restore(toConnectionEntity(po), config);
    }

    @Override
    public List<SshConnectionEntity> queryByUserId(String userId) {
        return connectionDao.queryByUserId(userId).stream()
                .map(this::toConnectionEntity)
                .toList();
    }

    @Override
    public void remove(String connectionId) {
        connectionDao.softDeleteByConnectionId(connectionId);
        configDao.deleteByConnectionId(connectionId);
    }

    // ===== 聚合根 ↔ PO 转换（password / privateKey 走加解密）=====

    private SshConnectionPO toConnectionPO(SshConnectionEntity e) {
        return SshConnectionPO.builder()
                .connectionId(e.getConnectionId())
                .name(e.getName())
                .host(e.getHost())
                .port(e.getPort())
                .username(e.getUsername())
                .authType(e.getAuthType().getCode())
                .password(cipher.encrypt(e.getPassword()))
                .privateKey(cipher.encrypt(e.getPrivateKey()))
                .userId(e.getUserId())
                .build();
    }

    private SshConnectionEntity toConnectionEntity(SshConnectionPO po) {
        return SshConnectionEntity.restore(
                po.getConnectionId(),
                po.getName(),
                po.getHost(),
                po.getPort(),
                po.getUsername(),
                AuthTypeEnum.of(po.getAuthType()),
                cipher.decrypt(po.getPassword()),
                cipher.decrypt(po.getPrivateKey()),
                po.getUserId());
    }

    private SshConnectionConfigPO toConfigPO(SshConnectionConfigEntity c) {
        return SshConnectionConfigPO.builder()
                .connectionId(c.getConnectionId())
                .connectTimeout(c.getConnectTimeout())
                .keepaliveInterval(c.getKeepaliveInterval())
                .startupCommand(c.getStartupCommand())
                .strictHostKeyCheck(c.isStrictHostKeyCheck() ? 1 : 0)
                .knownHosts(c.getKnownHosts())
                .compression(c.isCompression() ? 1 : 0)
                .build();
    }

    private SshConnectionConfigEntity toConfigEntity(SshConnectionConfigPO po) {
        return SshConnectionConfigEntity.restore(
                po.getConnectionId(),
                po.getConnectTimeout(),
                po.getKeepaliveInterval(),
                po.getStartupCommand(),
                po.getStrictHostKeyCheck() != null && po.getStrictHostKeyCheck() == 1,
                po.getKnownHosts(),
                po.getCompression() != null && po.getCompression() == 1);
    }

    /** 旧数据无高级配置行时，返回填充默认值的配置实体 */
    private SshConnectionConfigEntity defaultConfig(String connectionId) {
        SshConnectionConfigEntity config = SshConnectionConfigEntity.create(connectionId, null, null, "", false, "", false);
        config.applyDefaults();
        return config;
    }
}
