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

    /** 按连接标识查询 */
    SshConnectionConfigPO queryByConnectionId(@Param("connectionId") String connectionId);

}
