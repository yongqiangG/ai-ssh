package com.johnny.domain.ssh.adapter.repository;

import com.johnny.domain.ssh.model.aggregate.SshConnectionAggregate;
import com.johnny.domain.ssh.model.entity.SshConnectionEntity;

import java.util.List;

/**
 * SSH 连接仓储接口（依赖倒置）。
 * <p>
 * 定义在领域层，由基础设施层做具体实现；接口面向聚合根/实体，不暴露 PO。
 */
public interface ISshConnectionRepository {

    /** 新增聚合根（基础表 + 高级配置表） */
    void save(SshConnectionAggregate aggregate);

    /** 更新聚合根（基础表 update + 高级配置 upsert） */
    void update(SshConnectionAggregate aggregate);

    /** 仅更新基础实体（如连接状态变更） */
    void updateConnection(SshConnectionEntity connection);

    /** 按 connectionId 查询聚合根；不存在返回 null */
    SshConnectionAggregate queryByConnectionId(String connectionId);

    /** 按用户列出全部连接基础信息（列表场景，不含高级配置） */
    List<SshConnectionEntity> queryByUserId(String userId);

    /** 删除：基础表逻辑删除 + 高级配置物理删除 */
    void remove(String connectionId);
}
