package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.agent.model.LlmConfigEntity;
import com.johnny.domain.agent.model.LlmConfigRollbackSnapshot;
import org.junit.Before;
import org.junit.Test;

import java.util.Optional;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class LlmConfigRollbackServiceTest {

    private LlmConfigRollbackService service;

    @Before
    public void setUp() {
        service = new LlmConfigRollbackService();
    }

    @Test
    public void starts_without_a_rollback_snapshot() {
        assertFalse(service.getSnapshot().isPresent());
    }

    @Test
    public void remembers_complete_previous_config_and_replaces_the_single_slot() {
        LlmConfigEntity first = config("Provider A", "https://a.example", "key-a", "model-a");
        LlmConfigEntity second = config("Provider B", "https://b.example", "key-b", "model-b");
        LlmConfigEntity third = config("Provider C", "https://c.example", "key-c", "model-c");

        service.remember(first, second, true);
        service.remember(second, third, true);

        LlmConfigRollbackSnapshot snapshot = service.getSnapshot().orElseThrow();
        assertEquals("Provider B", snapshot.getPreviousConfig().getProviderName());
        assertEquals("key-b", snapshot.getPreviousConfig().getApiKey());
        assertEquals("Provider C", snapshot.getCurrentConfig().getProviderName());
        assertTrue(snapshot.isRunnerReloadRequired());
    }

    @Test
    public void ignores_an_incomplete_previous_config() {
        LlmConfigEntity unconfigured = config("Default", "https://default.example", "", "model");
        LlmConfigEntity configured = config("Provider A", "https://a.example", "key-a", "model-a");

        service.remember(unconfigured, configured, true);

        assertFalse(service.getSnapshot().isPresent());
    }

    @Test
    public void clear_removes_the_snapshot() {
        service.remember(
                config("Provider A", "https://a.example", "key-a", "model-a"),
                config("Provider B", "https://b.example", "key-b", "model-b"),
                true);

        service.clear();

        assertEquals(Optional.empty(), service.getSnapshot());
    }

    private LlmConfigEntity config(String provider, String baseUrl, String apiKey, String model) {
        return LlmConfigEntity.builder()
                .configId(LlmConfigEntity.DEFAULT_CONFIG_ID)
                .providerName(provider)
                .baseUrl(baseUrl)
                .apiKey(apiKey)
                .model(model)
                .completionsPath("/v1/chat/completions")
                .build();
    }
}
