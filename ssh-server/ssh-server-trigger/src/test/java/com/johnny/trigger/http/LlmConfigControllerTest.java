package com.johnny.trigger.http;

import com.johnny.api.dto.LlmConfigDTO;
import com.johnny.api.dto.LlmConfigSaveRequestDTO;
import com.johnny.api.response.Response;
import com.johnny.domain.agent.model.LlmConfigEntity;
import com.johnny.domain.agent.model.LlmConfigRollbackSnapshot;
import com.johnny.domain.agent.model.LlmConfigSaveResult;
import com.johnny.domain.agent.service.AgentRunnerRegistry;
import com.johnny.domain.agent.service.ILlmConfigRollbackService;
import com.johnny.domain.agent.service.ILlmConfigService;
import com.johnny.types.exception.AppException;
import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Field;
import java.util.Objects;
import java.util.Optional;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class LlmConfigControllerTest {

    private FakeConfigService configService;
    private FakeRollbackService rollbackService;
    private CountingRunnerRegistry runnerRegistry;
    private LlmConfigController controller;

    @Before
    public void setUp() throws Exception {
        configService = new FakeConfigService(config("Provider A", "https://a.example", "key-a", "model-a"));
        rollbackService = new FakeRollbackService();
        runnerRegistry = new CountingRunnerRegistry();
        controller = new LlmConfigController();
        setField(controller, "llmConfigService", configService);
        setField(controller, "agentRunnerRegistry", runnerRegistry);
        setField(controller, "llmConfigRollbackService", rollbackService);
    }

    @Test
    public void save_exposes_rollback_summary_without_api_key() {
        Response<LlmConfigDTO> response = controller.saveConfig(request("Provider B", "https://b.example", "key-b", "model-b"));

        assertTrue(response.getData().getRollbackAvailable());
        assertEquals("Provider A", response.getData().getRollbackConfig().getProviderName());
        assertTrue(response.getData().getRollbackConfig().getApiKeyConfigured());
        assertEquals(1, runnerRegistry.rebuildCount);
    }

    @Test
    public void rollback_restores_full_config_and_clears_snapshot() {
        controller.saveConfig(request("Provider B", "https://b.example", "key-b", "model-b"));

        Response<LlmConfigDTO> response = controller.rollbackConfig();

        assertEquals("Provider A", response.getData().getProviderName());
        assertEquals("https://a.example", configService.current.getBaseUrl());
        assertEquals("key-a", configService.current.getApiKey());
        assertFalse(response.getData().getRollbackAvailable());
        assertEquals(2, runnerRegistry.rebuildCount);
    }

    @Test
    public void stale_rollback_does_not_overwrite_newer_config() {
        controller.saveConfig(request("Provider B", "https://b.example", "key-b", "model-b"));
        configService.current = config("Provider C", "https://c.example", "key-c", "model-c");

        try {
            controller.rollbackConfig();
            fail("expected stale rollback to be rejected");
        } catch (AppException e) {
            assertTrue(e.getInfo().contains("已发生变化"));
        }

        assertEquals("Provider C", configService.current.getProviderName());
    }

    @Test
    public void runner_rebuild_failure_keeps_snapshot_for_retry() {
        runnerRegistry.failNext = true;
        try {
            controller.saveConfig(request("Provider B", "https://b.example", "key-b", "model-b"));
            fail("expected runner rebuild failure");
        } catch (AppException e) {
            assertTrue(e.getInfo().contains("重建"));
        }

        assertTrue(controller.getConfig().getData().getRollbackAvailable());

        Response<LlmConfigDTO> response = controller.rollbackConfig();

        assertEquals("Provider A", response.getData().getProviderName());
        assertFalse(response.getData().getRollbackAvailable());
    }

    @Test
    public void first_configuration_does_not_create_rollback_snapshot() {
        configService.current = config("Default", "https://default.example", "", "model");

        Response<LlmConfigDTO> response = controller.saveConfig(request("Provider A", "https://a.example", "key-a", "model-a"));

        assertFalse(response.getData().getRollbackAvailable());
    }

    private LlmConfigSaveRequestDTO request(String provider, String baseUrl, String apiKey, String model) {
        LlmConfigSaveRequestDTO request = new LlmConfigSaveRequestDTO();
        request.setProviderName(provider);
        request.setBaseUrl(baseUrl);
        request.setApiKey(apiKey);
        request.setModel(model);
        request.setCompletionsPath("/v1/chat/completions");
        request.setKeepExistingApiKey(false);
        return request;
    }

    private static LlmConfigEntity config(String provider, String baseUrl, String apiKey, String model) {
        return LlmConfigEntity.builder()
                .configId(LlmConfigEntity.DEFAULT_CONFIG_ID)
                .providerName(provider)
                .baseUrl(baseUrl)
                .apiKey(apiKey)
                .model(model)
                .completionsPath("/v1/chat/completions")
                .build();
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static class CountingRunnerRegistry extends AgentRunnerRegistry {
        private int rebuildCount;
        private boolean failNext;

        @Override
        public synchronized void rebuild() {
            rebuildCount++;
            if (failNext) {
                failNext = false;
                throw new AppException("0001", "runner 重建失败");
            }
        }
    }

    private static class FakeRollbackService implements ILlmConfigRollbackService {
        private LlmConfigRollbackSnapshot snapshot;

        @Override
        public Optional<LlmConfigRollbackSnapshot> getSnapshot() {
            return Optional.ofNullable(snapshot);
        }

        @Override
        public void remember(LlmConfigEntity previousConfig, LlmConfigEntity currentConfig, boolean runnerReloadRequired) {
            if (previousConfig.hasApiKey()) {
                snapshot = new LlmConfigRollbackSnapshot(previousConfig, currentConfig, runnerReloadRequired);
            }
        }

        @Override
        public void clear() {
            snapshot = null;
        }
    }

    private static class FakeConfigService implements ILlmConfigService {
        private LlmConfigEntity current;

        private FakeConfigService(LlmConfigEntity current) {
            this.current = current;
        }

        @Override
        public LlmConfigEntity getDefaultConfig() {
            return current;
        }

        @Override
        public LlmConfigSaveResult saveDefaultConfig(LlmConfigEntity config, boolean keepExistingApiKey) {
            String apiKey = keepExistingApiKey && !config.hasApiKey() ? current.getApiKey() : config.getApiKey();
            LlmConfigEntity normalized = LlmConfigEntity.builder()
                    .configId(LlmConfigEntity.DEFAULT_CONFIG_ID)
                    .providerName(config.getProviderName())
                    .baseUrl(config.getBaseUrl())
                    .apiKey(apiKey)
                    .model(config.getModel())
                    .completionsPath(config.getCompletionsPath())
                    .build();
            boolean changed = !same(current, normalized);
            boolean runnerReloadRequired = changed
                    && (!Objects.equals(current.getBaseUrl(), normalized.getBaseUrl())
                    || !Objects.equals(current.getModel(), normalized.getModel())
                    || !Objects.equals(current.getCompletionsPath(), normalized.getCompletionsPath())
                    || !Objects.equals(current.getApiKey(), normalized.getApiKey()));
            current = normalized;
            return LlmConfigSaveResult.builder()
                    .config(normalized)
                    .configChanged(changed)
                    .runnerReloadRequired(runnerReloadRequired)
                    .build();
        }

        private boolean same(LlmConfigEntity left, LlmConfigEntity right) {
            return Objects.equals(left.getProviderName(), right.getProviderName())
                    && Objects.equals(left.getBaseUrl(), right.getBaseUrl())
                    && Objects.equals(left.getApiKey(), right.getApiKey())
                    && Objects.equals(left.getModel(), right.getModel())
                    && Objects.equals(left.getCompletionsPath(), right.getCompletionsPath());
        }
    }
}
