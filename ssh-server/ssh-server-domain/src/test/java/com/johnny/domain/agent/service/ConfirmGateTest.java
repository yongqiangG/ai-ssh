package com.johnny.domain.agent.service;

import org.junit.Test;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * 确认门挂起/唤醒/拒绝语义测试（超时场景不真等 120s，验证保守拒绝路径即可）。
 */
public class ConfirmGateTest {

    @Test
    public void allow_decision_unblocks_with_true() throws Exception {
        ConfirmGate gate = new ConfirmGate();
        AtomicReference<ConfirmGate.ConfirmRequest> captured = new AtomicReference<>();
        gate.registerEmitter("s1", captured::set);

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            CompletableFuture<Boolean> toolResult = CompletableFuture.supplyAsync(
                    () -> gate.requestConfirm("s1", "fc-1", "rm /tmp/x", "命中写规则"), pool);

            // 等 confirm_request 发射出来
            long deadline = System.currentTimeMillis() + 3000;
            while (captured.get() == null && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
            ConfirmGate.ConfirmRequest cr = captured.get();
            assertNotNull("应发射 confirm_request", cr);
            assertEquals("fc-1", cr.toolCallId);
            assertEquals("rm /tmp/x", cr.command);

            assertTrue("应找到等待中的确认", gate.decide(cr.confirmId, true));
            assertTrue("允许后工具应放行", toolResult.get(3, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    public void deny_decision_unblocks_with_false() throws Exception {
        ConfirmGate gate = new ConfirmGate();
        AtomicReference<ConfirmGate.ConfirmRequest> captured = new AtomicReference<>();
        gate.registerEmitter("s2", captured::set);

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            CompletableFuture<Boolean> toolResult = CompletableFuture.supplyAsync(
                    () -> gate.requestConfirm("s2", "fc-2", "systemctl stop nginx", "命中写规则"), pool);
            long deadline = System.currentTimeMillis() + 3000;
            while (captured.get() == null && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
            assertNotNull(captured.get());

            assertTrue(gate.decide(captured.get().confirmId, false));
            assertFalse("拒绝后工具不得执行", toolResult.get(3, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    public void no_emitter_channel_denies_conservatively() {
        ConfirmGate gate = new ConfirmGate();
        // 未注册发射通道：绝不静默放行写命令
        assertFalse(gate.requestConfirm("unregistered", "fc-3", "rm -f x", "命中写规则"));
    }

    @Test
    public void decide_unknown_confirmId_returns_false() {
        ConfirmGate gate = new ConfirmGate();
        assertFalse(gate.decide("nonexistent", true));
        assertFalse(gate.decide(null, true));
    }
}
