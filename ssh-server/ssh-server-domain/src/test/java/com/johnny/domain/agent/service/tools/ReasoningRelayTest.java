package com.johnny.domain.agent.service.tools;

import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/**
 * ReasoningRelay 旁路单测：注册/注销/空片段安全（真实思维链流转由集成验证覆盖）。
 */
public class ReasoningRelayTest {

    @After
    public void tearDown() {
        ReasoningRelay.register(null);
    }

    @Test
    public void 注册后按序收到片段() {
        List<String> received = new ArrayList<>();
        ReasoningRelay.register(received::add);
        ReasoningRelay.emit("让我");
        ReasoningRelay.emit("想想");
        assertEquals(Arrays.asList("让我", "想想"), received);
    }

    @Test
    public void 未注册或已注销时emit静默不抛() {
        ReasoningRelay.emit("孤儿片段");
        List<String> received = new ArrayList<>();
        ReasoningRelay.register(received::add);
        ReasoningRelay.register(null);
        ReasoningRelay.emit("注销后的片段");
        assertTrue(received.isEmpty());
    }

    @Test
    public void 空与null片段被过滤() {
        List<String> received = new ArrayList<>();
        ReasoningRelay.register(received::add);
        ReasoningRelay.emit("");
        ReasoningRelay.emit(null);
        assertTrue(received.isEmpty());
    }
}
