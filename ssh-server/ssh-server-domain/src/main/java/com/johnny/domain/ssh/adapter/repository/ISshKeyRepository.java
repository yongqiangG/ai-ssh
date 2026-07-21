package com.johnny.domain.ssh.adapter.repository;

import com.johnny.domain.ssh.model.entity.SshKeyEntity;

import java.util.List;

/**
 * SSH 密钥仓储端口；实现位于 infrastructure（privateKey/passphrase 落库加密、读取解密）。
 */
public interface ISshKeyRepository {

    /** 保存新密钥 */
    void save(SshKeyEntity key);

    /** 按 keyId 更新（name/privateKey/passphrase） */
    void update(SshKeyEntity key);

    /** 按 keyId 查询（排除已删除）；不存在返回 null */
    SshKeyEntity queryByKeyId(String keyId);

    /** 列出用户全部密钥 */
    List<SshKeyEntity> queryByUserId(String userId);

    /** 逻辑删除 */
    void remove(String keyId);
}
