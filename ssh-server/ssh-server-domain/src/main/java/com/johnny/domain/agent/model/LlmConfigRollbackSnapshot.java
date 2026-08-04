package com.johnny.domain.agent.model;

import java.util.Objects;

/**
 * 进程内保存的单步 LLM 配置回滚快照。
 *
 * <p>快照包含 API Key，但只在 server 内部使用，不能直接映射为 HTTP DTO。</p>
 */
public final class LlmConfigRollbackSnapshot {

    private final LlmConfigEntity previousConfig;
    private final LlmConfigEntity currentConfig;
    private final boolean runnerReloadRequired;

    public LlmConfigRollbackSnapshot(
            LlmConfigEntity previousConfig,
            LlmConfigEntity currentConfig,
            boolean runnerReloadRequired) {
        this.previousConfig = copy(previousConfig);
        this.currentConfig = copy(currentConfig);
        this.runnerReloadRequired = runnerReloadRequired;
    }

    public LlmConfigEntity getPreviousConfig() {
        return copy(previousConfig);
    }

    public LlmConfigEntity getCurrentConfig() {
        return copy(currentConfig);
    }

    public boolean isRunnerReloadRequired() {
        return runnerReloadRequired;
    }

    public boolean matchesCurrent(LlmConfigEntity candidate) {
        return sameConfig(currentConfig, candidate);
    }

    public boolean matchesPrevious(LlmConfigEntity candidate) {
        return sameConfig(previousConfig, candidate);
    }

    private static boolean sameConfig(LlmConfigEntity left, LlmConfigEntity right) {
        if (left == null || right == null) {
            return left == right;
        }
        return Objects.equals(left.getConfigId(), right.getConfigId())
                && Objects.equals(left.getProviderName(), right.getProviderName())
                && Objects.equals(left.getBaseUrl(), right.getBaseUrl())
                && Objects.equals(left.getApiKey(), right.getApiKey())
                && Objects.equals(left.getModel(), right.getModel())
                && Objects.equals(left.getCompletionsPath(), right.getCompletionsPath());
    }

    private static LlmConfigEntity copy(LlmConfigEntity source) {
        if (source == null) {
            return null;
        }
        return LlmConfigEntity.builder()
                .configId(source.getConfigId())
                .providerName(source.getProviderName())
                .baseUrl(source.getBaseUrl())
                .apiKey(source.getApiKey())
                .model(source.getModel())
                .completionsPath(source.getCompletionsPath())
                .build();
    }
}
