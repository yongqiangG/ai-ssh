package com.johnny.infrastructure.migration;

import com.johnny.domain.ssh.adapter.port.ISecretCipher;
import com.johnny.domain.ssh.adapter.repository.ISshKeyRepository;
import com.johnny.domain.ssh.model.entity.SshKeyEntity;
import com.johnny.infrastructure.dao.ISshConnectionDao;
import com.johnny.infrastructure.dao.po.SshConnectionPO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * 存量数据迁移：把连接内嵌的私钥（ssh_connection.private_key）提升为一等密钥实体（ssh_key），
 * 连接改为 key_id 引用，内嵌列清空。
 * <p>
 * 幂等：只处理 private_key 非空且 key_id 为空的行；迁移后不再命中。
 * 单条失败只记日志不阻断启动（下次启动重试）。
 */
@Slf4j
@Component
public class LegacyKeyMigrationRunner implements ApplicationRunner {

    private final ISshConnectionDao connectionDao;
    private final ISshKeyRepository keyRepository;
    private final ISecretCipher cipher;

    public LegacyKeyMigrationRunner(ISshConnectionDao connectionDao,
                                    ISshKeyRepository keyRepository,
                                    ISecretCipher cipher) {
        this.connectionDao = connectionDao;
        this.keyRepository = keyRepository;
        this.cipher = cipher;
    }

    @Override
    public void run(ApplicationArguments args) {
        List<SshConnectionPO> legacyRows = connectionDao.queryLegacyWithEmbeddedKey();
        if (legacyRows.isEmpty()) {
            return;
        }
        log.info("检测到 {} 条内嵌私钥的存量连接，开始迁移为密钥实体引用", legacyRows.size());
        for (SshConnectionPO po : legacyRows) {
            try {
                String keyId = UUID.randomUUID().toString().replace("-", "");
                // 内嵌列存的是密文，解密回明文交给密钥仓储重新加密落库（密钥表与连接表同 cipher）
                String privateKeyPlain = cipher.decrypt(po.getPrivateKey());
                SshKeyEntity key = SshKeyEntity.create(
                        keyId, po.getName() + "-密钥", privateKeyPlain, null, po.getUserId());
                keyRepository.save(key);
                connectionDao.migrateToKeyRef(po.getConnectionId(), keyId);
                log.info("连接内嵌私钥已迁移 connectionId={} -> keyId={}", po.getConnectionId(), keyId);
            } catch (Exception e) {
                log.error("连接内嵌私钥迁移失败（跳过，下次启动重试）connectionId={}", po.getConnectionId(), e);
            }
        }
    }
}
