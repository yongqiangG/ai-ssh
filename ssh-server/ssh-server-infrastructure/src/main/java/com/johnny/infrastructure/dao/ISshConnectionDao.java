package com.johnny.infrastructure.dao;

import com.johnny.infrastructure.dao.po.SshConnectionPO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * SSH 连接基础配置 DAO
 */
@Mapper
public interface ISshConnectionDao {

    /** 新增连接配置；成功后回写自增主键到 po.id */
    void insert(SshConnectionPO po);

    /** 按连接标识查询（排除逻辑删除） */
    SshConnectionPO queryByConnectionId(@Param("connectionId") String connectionId);

}
