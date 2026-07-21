package com.johnny.domain.ssh.model.entity;

import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.Getter;
import org.apache.commons.lang3.StringUtils;

/**
 * SSH 密钥实体（一等实体，可被多个连接引用）。
 * <p>
 * 仅暴露 getter，写操作通过工厂方法完成校验与装配；已落库数据经 {@link #restore} 还原（跳过校验）。
 * privateKey/passphrase 在领域内保持明文，加密发生在仓储落库边界（与连接凭据同约定）。
 */
@Getter
public class SshKeyEntity {

    /** 密钥名称最大长度（与 ssh_key.name varchar(64) 对齐） */
    private static final int NAME_MAX_LENGTH = 64;

    private String keyId;
    private String name;
    /** 明文私钥（PEM 内容） */
    private String privateKey;
    /** 明文私钥口令；无口令为 null/空 */
    private String passphrase;
    private String userId;

    private SshKeyEntity() {
    }

    /** 是否设置了私钥口令（DTO 回显布尔，密文永不回传） */
    public boolean hasPassphrase() {
        return StringUtils.isNotBlank(passphrase);
    }

    /**
     * 领域校验：名称与私钥内容。
     *
     * @throws AppException 任一校验失败
     */
    public static void validate(String name, String privateKey) {
        if (StringUtils.isBlank(name)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "密钥名称不能为空");
        }
        if (name.length() > NAME_MAX_LENGTH) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "密钥名称长度不能超过 " + NAME_MAX_LENGTH);
        }
        if (StringUtils.isBlank(privateKey)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "私钥内容不能为空");
        }
    }

    /**
     * 新建密钥：先校验再装配。
     *
     * @throws AppException 校验失败
     */
    public static SshKeyEntity create(String keyId, String name, String privateKey, String passphrase, String userId) {
        validate(name, privateKey);
        SshKeyEntity entity = new SshKeyEntity();
        entity.keyId = keyId;
        entity.name = name;
        entity.privateKey = privateKey;
        entity.passphrase = passphrase;
        entity.userId = userId;
        return entity;
    }

    /**
     * 从持久化数据还原（跳过校验，信任已落库数据）。
     */
    public static SshKeyEntity restore(String keyId, String name, String privateKey, String passphrase, String userId) {
        SshKeyEntity entity = new SshKeyEntity();
        entity.keyId = keyId;
        entity.name = name;
        entity.privateKey = privateKey;
        entity.passphrase = passphrase;
        entity.userId = userId;
        return entity;
    }
}
