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
 * 确认门挂起/唤醒/拒绝/超时语义测试（超时用注入的短上限真走 future.get 超时分支，不真等 120s）。
 */
public class ConfirmGateTest {

    @Test
    public void timeout_without_decision_denies() {
        ConfirmGate gate = new ConfirmGate();
        gate.setTimeoutSecondsForTest(0);
        gate.registerEmitter("s-timeout", cr -> { /* 发射成功但无人决策 */ });
        // 上限 0s：future.get 立即超时 → 保守拒绝（同步调用即可，无需工具线程）
        assertFalse("超时必须按拒绝处理", gate.requestConfirm("s-timeout", "fc-t", "rm -f /tmp/x", "命中写规则"));
    }

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

    @Test
    public void cancel_session_wakes_pending_with_deny() throws Exception {
        ConfirmGate gate = new ConfirmGate();
        AtomicReference<ConfirmGate.ConfirmRequest> captured = new AtomicReference<>();
        gate.registerEmitter("s-cancel", captured::set);

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            CompletableFuture<Boolean> toolResult = CompletableFuture.supplyAsync(
                    () -> gate.requestConfirm("s-cancel", "fc-c", "rm /tmp/x", "命中写规则"), pool);
            long deadline = System.currentTimeMillis() + 3000;
            while (captured.get() == null && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
            assertNotNull("应发射 confirm_request", captured.get());

            gate.cancelSession("s-cancel");
            assertFalse("会话取消后挂起确认必须按拒绝唤醒", toolResult.get(3, TimeUnit.SECONDS));
            // 已被取消清理：后续 decide 找不到该确认
            assertFalse(gate.decide(captured.get().confirmId, true));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    public void cancel_session_leaves_other_sessions_untouched() throws Exception {
        ConfirmGate gate = new ConfirmGate();
        AtomicReference<ConfirmGate.ConfirmRequest> captured = new AtomicReference<>();
        gate.registerEmitter("s-other", captured::set);

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            CompletableFuture<Boolean> toolResult = CompletableFuture.supplyAsync(
                    () -> gate.requestConfirm("s-other", "fc-o", "touch /tmp/y", "命中写规则"), pool);
            long deadline = System.currentTimeMillis() + 3000;
            while (captured.get() == null && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
            assertNotNull(captured.get());

            gate.cancelSession("unrelated-session");
            // 其它会话的确认不受影响，仍可正常允许
            assertTrue(gate.decide(captured.get().confirmId, true));
            assertTrue(toolResult.get(3, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }
}
