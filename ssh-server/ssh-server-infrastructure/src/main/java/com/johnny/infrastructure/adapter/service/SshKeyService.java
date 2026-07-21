package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.ssh.adapter.repository.ISshKeyRepository;
import com.johnny.domain.ssh.model.entity.SshKeyEntity;
import com.johnny.domain.ssh.service.ISshKeyService;
import com.johnny.infrastructure.dao.ISshConnectionDao;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * SSH 密钥领域服务实现。
 * <p>
 * 更新遵循「留空不改」：Cmd 字段为 null/blank 时沿用旧值（清空口令的场景请重建密钥）。
 * 删除前校验连接引用，避免连接悬挂到不存在的密钥。
 */
@Service
public class SshKeyService implements ISshKeyService {

    private final ISshKeyRepository keyRepository;
    private final ISshConnectionDao connectionDao;

    public SshKeyService(ISshKeyRepository keyRepository, ISshConnectionDao connectionDao) {
        this.keyRepository = keyRepository;
        this.connectionDao = connectionDao;
    }

    @Override
    public String create(CreateCmd cmd) {
        String keyId = UUID.randomUUID().toString().replace("-", "");
        SshKeyEntity entity = SshKeyEntity.create(keyId, cmd.name, cmd.privateKey, cmd.passphrase, cmd.userId);
        keyRepository.save(entity);
        return keyId;
    }

    @Override
    public void update(String keyId, UpdateCmd cmd) {
        SshKeyEntity old = requireKey(keyId);
        String name = StringUtils.isBlank(cmd.name) ? old.getName() : cmd.name;
        String privateKey = StringUtils.isBlank(cmd.privateKey) ? old.getPrivateKey() : cmd.privateKey;
        String passphrase = StringUtils.isBlank(cmd.passphrase) ? old.getPassphrase() : cmd.passphrase;
        SshKeyEntity updated = SshKeyEntity.create(keyId, name, privateKey, passphrase, old.getUserId());
        keyRepository.update(updated);
    }

    @Override
    public List<SshKeyEntity> list(String userId) {
        return keyRepository.queryByUserId(userId);
    }

    @Override
    public SshKeyEntity query(String keyId) {
        return requireKey(keyId);
    }

    @Override
    public void remove(String keyId) {
        requireKey(keyId);
        int refs = connectionDao.countByKeyId(keyId);
        if (refs > 0) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "密钥正被 " + refs + " 个连接引用，请先解除引用再删除");
        }
        keyRepository.remove(keyId);
    }

    private SshKeyEntity requireKey(String keyId) {
        SshKeyEntity entity = keyRepository.queryByKeyId(keyId);
        if (entity == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "密钥不存在: " + keyId);
        }
        return entity;
    }
}
