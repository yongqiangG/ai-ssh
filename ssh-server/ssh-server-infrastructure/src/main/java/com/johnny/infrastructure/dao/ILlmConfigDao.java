package com.johnny.infrastructure.dao;

import com.johnny.infrastructure.dao.po.LlmConfigPO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ILlmConfigDao {

    LlmConfigPO queryByConfigId(@Param("configId") String configId);

    void insert(LlmConfigPO po);

    int update(LlmConfigPO po);
}
