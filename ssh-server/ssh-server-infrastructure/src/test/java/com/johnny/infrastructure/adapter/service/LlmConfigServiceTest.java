package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.agent.model.LlmConfigEntity;
import com.johnny.domain.agent.model.LlmConfigSaveResult;
import com.johnny.domain.ssh.adapter.port.ISecretCipher;
import com.johnny.infrastructure.dao.ILlmConfigDao;
import com.johnny.infrastructure.dao.po.LlmConfigPO;
import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Field;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class LlmConfigServiceTest {

    private FakeDao dao;
    private LlmConfigService service;

    @Before
    public void setUp() throws Exception {
        dao = new FakeDao();
        dao.stored = LlmConfigPO.builder()
                .configId(LlmConfigEntity.DEFAULT_CONFIG_ID)
                .providerName("OpenAI Compatible")
                .baseUrl("https://example.com")
                .apiKey("secret")
                .model("model-a")
                .completionsPath("/v1/chat/completions")
                .build();
        service = new LlmConfigService(dao, new IdentityCipher());
        setField("defaultProviderName", "OpenAI Compatible");
        setField("defaultBaseUrl", "https://example.com");
        setField("defaultCompletionsPath", "/v1/chat/completions");
        setField("defaultModel", "model-a");
    }

    @Test
    public void unchanged_config_does_not_write_or_require_runner_reload() {
        LlmConfigSaveResult result = service.saveDefaultConfig(config(
                "OpenAI Compatible", "https://example.com", "", "model-a"), true);

        assertFalse(result.configChanged());
        assertFalse(result.runnerReloadRequired());
        assertFalse(dao.updated);
    }

    @Test
    public void provider_name_only_persists_without_runner_reload() {
        LlmConfigSaveResult result = service.saveDefaultConfig(config(
                "内部网关", "https://example.com", "", "model-a"), true);

        assertTrue(result.configChanged());
        assertFalse(result.runnerReloadRequired());
        assertTrue(dao.updated);
    }

    @Test
    public void model_change_persists_and_requires_runner_reload() {
        LlmConfigSaveResult result = service.saveDefaultConfig(config(
                "OpenAI Compatible", "https://example.com", "", "model-b"), true);

        assertTrue(result.configChanged());
        assertTrue(result.runnerReloadRequired());
        assertTrue(dao.updated);
    }

    private LlmConfigEntity config(String provider, String baseUrl, String apiKey, String model) {
        return LlmConfigEntity.builder()
                .providerName(provider)
                .baseUrl(baseUrl)
                .apiKey(apiKey)
                .model(model)
                .completionsPath("/v1/chat/completions")
                .build();
    }

    private void setField(String name, String value) throws Exception {
        Field field = LlmConfigService.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(service, value);
    }

    private static class IdentityCipher implements ISecretCipher {
        @Override
        public String encrypt(String plaintext) {
            return plaintext;
        }

        @Override
        public String decrypt(String ciphertext) {
            return ciphertext;
        }
    }

    private static class FakeDao implements ILlmConfigDao {
        private LlmConfigPO stored;
        private boolean updated;

        @Override
        public LlmConfigPO queryByConfigId(String configId) {
            return stored;
        }

        @Override
        public void insert(LlmConfigPO po) {
            stored = po;
        }

        @Override
        public int update(LlmConfigPO po) {
            stored = po;
            updated = true;
            return 1;
        }
    }
}
