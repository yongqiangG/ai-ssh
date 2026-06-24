package com.johnny.infrastructure.dao;

import com.johnny.infrastructure.dao.po.SshConnectionPO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * SSH 连接基础配置 DAO
 */
@Mapper
public interface ISshConnectionDao {

    /** 新增连接配置；成功后回写自增主键到 po.id */
    void insert(SshConnectionPO po);

    /** 按连接标识更新业务字段；返回影响行数（0 表示记录不存在或已删除） */
    int update(SshConnectionPO po);

    /** 按连接标识逻辑删除（deleted=1）；返回影响行数 */
    int softDeleteByConnectionId(@Param("connectionId") String connectionId);

    /** 按连接标识查询（排除逻辑删除） */
    SshConnectionPO queryByConnectionId(@Param("connectionId") String connectionId);

    /** 按用户查询其全部连接（排除逻辑删除，按 id 倒序） */
    List<SshConnectionPO> queryByUserId(@Param("userId") String userId);

}
