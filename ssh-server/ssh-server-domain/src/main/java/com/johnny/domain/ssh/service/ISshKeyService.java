package com.johnny.domain.ssh.service;

import com.johnny.domain.ssh.model.entity.SshKeyEntity;

import java.util.List;

/**
 * SSH 密钥领域服务接口（一等实体 CRUD）。
 * <p>Cmd 约定与连接服务一致：Update 中字段为 null 表示不修改。
 */
public interface ISshKeyService {

    /** 创建密钥，返回 keyId */
    String create(CreateCmd cmd);

    /** 更新密钥（null 字段不修改；privateKey/passphrase 留空即保持原值） */
    void update(String keyId, UpdateCmd cmd);

    /** 列出用户全部密钥 */
    List<SshKeyEntity> list(String userId);

    /** 查询单个密钥 */
    SshKeyEntity query(String keyId);

    /** 删除密钥（被连接引用时拒绝删除，避免连接悬挂） */
    void remove(String keyId);

    /** 创建密钥命令（纯 POJO，字段即入参） */
    class CreateCmd {
        public String userId;
        public String name;
        public String privateKey;
        public String passphrase;
    }

    /** 更新密钥命令（字段为 null 表示不修改） */
    class UpdateCmd {
        public String name;
        public String privateKey;
        public String passphrase;
    }
}
