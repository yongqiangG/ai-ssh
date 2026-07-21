package com.johnny.infrastructure.dao;

import com.johnny.infrastructure.dao.po.SshKeyPO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * SSH 密钥 DAO
 */
@Mapper
public interface ISshKeyDao {

    /** 新增密钥；成功后回写自增主键到 po.id */
    void insert(SshKeyPO po);

    /** 按 keyId 更新业务字段；返回影响行数（0 表示记录不存在或已删除） */
    int update(SshKeyPO po);

    /** 按 keyId 逻辑删除（deleted=1）；返回影响行数 */
    int softDeleteByKeyId(@Param("keyId") String keyId);

    /** 按 keyId 查询（排除逻辑删除） */
    SshKeyPO queryByKeyId(@Param("keyId") String keyId);

    /** 按用户查询其全部密钥（排除逻辑删除，按 id 倒序） */
    List<SshKeyPO> queryByUserId(@Param("userId") String userId);

}
