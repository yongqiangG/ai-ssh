package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.agent.model.LlmConfigEntity;
import com.johnny.domain.agent.model.LlmConfigRollbackSnapshot;
import com.johnny.domain.agent.service.ILlmConfigRollbackService;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * LLM 配置回滚快照的进程内实现。
 *
 * <p>不写数据库、不向 client 暴露 API Key；server 进程重启后快照自然丢失。</p>
 */
@Service
public class LlmConfigRollbackService implements ILlmConfigRollbackService {

    private volatile LlmConfigRollbackSnapshot snapshot;

    @Override
    public Optional<LlmConfigRollbackSnapshot> getSnapshot() {
        return Optional.ofNullable(snapshot);
    }

    @Override
    public void remember(
            LlmConfigEntity previousConfig,
            LlmConfigEntity currentConfig,
            boolean runnerReloadRequired) {
        if (previousConfig == null || !previousConfig.hasApiKey() || currentConfig == null) {
            return;
        }
        snapshot = new LlmConfigRollbackSnapshot(previousConfig, currentConfig, runnerReloadRequired);
    }

    @Override
    public void clear() {
        snapshot = null;
    }
}
