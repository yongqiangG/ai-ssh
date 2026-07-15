package com.johnny.domain.agent.service;

import com.johnny.domain.agent.model.LlmConfigEntity;

/**
 * LLM 配置服务。当前只维护一个默认配置，避免过早引入多模型路由。
 */
public interface ILlmConfigService {

    LlmConfigEntity getDefaultConfig();

    LlmConfigEntity saveDefaultConfig(LlmConfigEntity config, boolean keepExistingApiKey);
}
