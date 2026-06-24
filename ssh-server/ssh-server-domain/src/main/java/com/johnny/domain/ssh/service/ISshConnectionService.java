package com.johnny.domain.ssh.service;

import com.johnny.domain.ssh.model.aggregate.SshConnectionAggregate;
import com.johnny.domain.ssh.model.entity.SshConnectionEntity;
import com.johnny.domain.ssh.model.valobj.AuthTypeVO;

import java.util.List;

/**
 * SSH 连接领域服务接口。
 * <p>
 * 编排连接的增删改查与会话连接管理；连接管理委托 {@code ISshSessionPort}。
 */
public interface ISshConnectionService {

    /** 创建连接：校验 → 生成 connectionId → 填充默认值 → 保存基础信息与高级配置。返回 connectionId */
    String create(CreateCmd cmd);

    /** 更新连接：cmd 中非 null 字段覆盖旧值，重新校验后更新 */
    void update(String connectionId, UpdateCmd cmd);

    /** 查询单个连接聚合根 */
    SshConnectionAggregate query(String connectionId);

    /** 列出用户全部连接 */
    List<SshConnectionEntity> list(String userId);

    /** 删除连接 */
    void remove(String connectionId);

    /** 建立连接 */
    boolean connect(String connectionId);

    /** 断开连接 */
    void disconnect(String connectionId);

    /** 是否已连接 */
    boolean isConnected(String connectionId);

    /** 创建连接命令（纯 POJO，字段即入参） */
    class CreateCmd {
        public String userId;
        public String name;
        public String host;
        public int port;
        public String username;
        public String password;
        public String privateKey;
        public AuthTypeVO authType;
        public Integer connectTimeout;
        public Integer keepaliveInterval;
        public String startupCommand;
        public String knownHosts;
        public boolean strictHostKeyCheck;
        public boolean compression;
    }

    /** 更新连接命令（字段为 null 表示不修改） */
    class UpdateCmd {
        public String name;
        public String host;
        public Integer port;
        public String username;
        public String password;
        public String privateKey;
        public AuthTypeVO authType;
        public Integer connectTimeout;
        public Integer keepaliveInterval;
        public String startupCommand;
        public String knownHosts;
        public Boolean strictHostKeyCheck;
        public Boolean compression;
    }
}
