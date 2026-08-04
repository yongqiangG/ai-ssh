package com.johnny.domain.agent.service;

import com.johnny.domain.agent.model.LlmConfigEntity;
import com.johnny.domain.agent.model.LlmConfigRollbackSnapshot;

import java.util.Optional;

/** 进程内 LLM 配置单步回滚快照。 */
public interface ILlmConfigRollbackService {

    Optional<LlmConfigRollbackSnapshot> getSnapshot();

    void remember(LlmConfigEntity previousConfig, LlmConfigEntity currentConfig, boolean runnerReloadRequired);

    void clear();
}
