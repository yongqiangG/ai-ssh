package com.johnny.domain.react.node;

import org.junit.Test;

import java.io.IOException;
import java.util.concurrent.TimeoutException;

import static org.junit.Assert.assertEquals;

public class LlmErrorHumanizerTest {

    @Test
    public void eof_maps_to_connection_lost() {
        RuntimeException e = new RuntimeException(
                "Unknown error: WebClientRequestException - EOF reached while reading");
        assertEquals("LLM_CONNECTION_LOST", LlmErrorHumanizer.humanize(e).code());
    }

    @Test
    public void nested_cause_is_searched() {
        RuntimeException e = new RuntimeException("wrapper",
                new IOException("Connection reset by peer"));
        assertEquals("LLM_CONNECTION_LOST", LlmErrorHumanizer.humanize(e).code());
    }

    @Test
    public void auth_error() {
        RuntimeException e = new RuntimeException("401 Unauthorized from POST /v1/chat/completions");
        assertEquals("LLM_AUTH_FAILED", LlmErrorHumanizer.humanize(e).code());
    }

    @Test
    public void rate_limited() {
        RuntimeException e = new RuntimeException("429 Too Many Requests");
        assertEquals("LLM_RATE_LIMITED", LlmErrorHumanizer.humanize(e).code());
    }

    @Test
    public void timeout() {
        assertEquals("LLM_TIMEOUT",
                LlmErrorHumanizer.humanize(new TimeoutException("request timed out")).code());
    }

    @Test
    public void bad_config() {
        RuntimeException e = new RuntimeException("404 Not Found: model not found");
        assertEquals("LLM_BAD_CONFIG", LlmErrorHumanizer.humanize(e).code());
    }

    @Test
    public void server_error() {
        RuntimeException e = new RuntimeException("503 Service Unavailable");
        assertEquals("LLM_SERVER_ERROR", LlmErrorHumanizer.humanize(e).code());
    }

    @Test
    public void unknown_fallback_has_human_message() {
        LlmErrorHumanizer.Result r = LlmErrorHumanizer.humanize(new RuntimeException("weird"));
        assertEquals("LLM_UNKNOWN", r.code());
        // 兜底也必须是人话指引，不能是技术串
        assertEquals(true, r.message().contains("模型设置"));
    }
}
