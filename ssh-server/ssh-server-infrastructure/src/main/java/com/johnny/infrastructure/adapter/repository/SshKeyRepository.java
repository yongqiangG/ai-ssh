package com.johnny.infrastructure.adapter.repository;

import com.johnny.domain.ssh.adapter.port.ISecretCipher;
import com.johnny.domain.ssh.adapter.repository.ISshKeyRepository;
import com.johnny.domain.ssh.model.entity.SshKeyEntity;
import com.johnny.infrastructure.dao.ISshKeyDao;
import com.johnny.infrastructure.dao.po.SshKeyPO;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * SSH 密钥仓储实现（依赖倒置：实现领域层接口）。
 * <p>
 * privateKey 与 passphrase 在落库前加密、读取时解密（与连接凭据同边界）。
 */
@Repository
public class SshKeyRepository implements ISshKeyRepository {

    private final ISshKeyDao keyDao;
    private final ISecretCipher cipher;

    public SshKeyRepository(ISshKeyDao keyDao, ISecretCipher cipher) {
        this.keyDao = keyDao;
        this.cipher = cipher;
    }

    @Override
    public void save(SshKeyEntity key) {
        keyDao.insert(toPO(key));
    }

    @Override
    public void update(SshKeyEntity key) {
        keyDao.update(toPO(key));
    }

    @Override
    public SshKeyEntity queryByKeyId(String keyId) {
        SshKeyPO po = keyDao.queryByKeyId(keyId);
        return po == null ? null : toEntity(po);
    }

    @Override
    public List<SshKeyEntity> queryByUserId(String userId) {
        return keyDao.queryByUserId(userId).stream()
                .map(this::toEntity)
                .toList();
    }

    @Override
    public void remove(String keyId) {
        keyDao.softDeleteByKeyId(keyId);
    }

    private SshKeyPO toPO(SshKeyEntity e) {
        return SshKeyPO.builder()
                .keyId(e.getKeyId())
                .name(e.getName())
                .privateKey(cipher.encrypt(e.getPrivateKey()))
                .passphrase(cipher.encrypt(e.getPassphrase()))
                .userId(e.getUserId())
                .build();
    }

    private SshKeyEntity toEntity(SshKeyPO po) {
        return SshKeyEntity.restore(
                po.getKeyId(),
                po.getName(),
                cipher.decrypt(po.getPrivateKey()),
                cipher.decrypt(po.getPassphrase()),
                po.getUserId());
    }
}
