package com.johnny.infrastructure.dao;

import com.johnny.infrastructure.dao.po.SshConnectionConfigPO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * SSH 连接高级配置 DAO
 */
@Mapper
public interface ISshConnectionConfigDao {

    /** 新增高级配置；成功后回写自增主键到 po.id */
    void insert(SshConnectionConfigPO po);

    /** 按连接标识更新高级配置；返回影响行数（0 表示记录不存在） */
    int update(SshConnectionConfigPO po);

    /** 按连接标识物理删除；返回影响行数 */
    int deleteByConnectionId(@Param("connectionId") String connectionId);

    /** 按连接标识查询 */
    SshConnectionConfigPO queryByConnectionId(@Param("connectionId") String connectionId);

    /**
     * 存量迁移：把 strict_host_key_check=0 的行翻为 1（幂等，迁移后不再命中）。
     * 迭代 A 只翻转了 DDL 列默认值，此前建的连接静默跳过 host key 校验，启动时统一补齐。
     *
     * @return 受影响行数
     */
    int enableStrictHostKeyCheckForLegacy();

}
