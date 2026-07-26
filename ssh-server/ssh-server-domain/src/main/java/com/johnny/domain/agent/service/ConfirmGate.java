package com.johnny.domain.agent.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

/**
 * 写操作确认门（B1）：工具在执行写命令前经此挂起，等前端用户点「允许/拒绝」。
 *
 * <p>协作三方：
 * <ol>
 *   <li>{@code AiCallNode}：请求开始时按 adkSessionId {@link #registerEmitter 注册}发射回调
 *       （把 confirm_request 写入该请求的 NDJSON emitter），结束时注销；</li>
 *   <li>工具（{@code SshExecuteAdkTool}）：判定需确认后调 {@link #requestConfirm}——
 *       发事件并<b>阻塞</b>工具线程等待，超时 {@value #TIMEOUT_SECONDS}s 视为拒绝；</li>
 *   <li>{@code ChatController} 的 confirm 端点：用户点击后调 {@link #decide} 唤醒。</li>
 * </ol>
 *
 * <p>红线（B1 决议）：不提供全局关闭开关；不记忆用户选择——每条写命令独立确认。
 */
@Slf4j
@Component
public class ConfirmGate {

    /** 等待用户决定的默认上限（秒）；超时按拒绝处理 */
    public static final long TIMEOUT_SECONDS = 120;

    /** 实际等待上限；默认 {@value #TIMEOUT_SECONDS}s，测试经 {@link #setTimeoutSecondsForTest} 缩短以真走超时分支 */
    private long timeoutSeconds = TIMEOUT_SECONDS;

    /** 仅测试用：缩短等待上限，让超时=拒绝路径可被单测真实覆盖（不真等 120s） */
    void setTimeoutSecondsForTest(long timeoutSeconds) {
        this.timeoutSeconds = timeoutSeconds;
    }

    /** confirm_request 事件载体 */
    public static class ConfirmRequest {
        public final String confirmId;
        /** 关联前端命令块（= functionCallId，与 tool_call 事件同源） */
        public final String toolCallId;
        public final String command;
        /** 判定理由（规则命中 / 模型自评） */
        public final String reason;

        public ConfirmRequest(String confirmId, String toolCallId, String command, String reason) {
            this.confirmId = confirmId;
            this.toolCallId = toolCallId;
            this.command = command;
            this.reason = reason;
        }
    }

    /** 挂起中的确认：future + 归属会话（cancelSession 按会话批量唤醒用） */
    private static class Pending {
        final CompletableFuture<Boolean> future;
        final String adkSessionId;

        Pending(CompletableFuture<Boolean> future, String adkSessionId) {
            this.future = future;
            this.adkSessionId = adkSessionId;
        }
    }

    /** confirmId → 等待用户决定的挂起项 */
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();

    /** adkSessionId → confirm_request 发射回调（写入该请求的 emitter） */
    private final Map<String, Consumer<ConfirmRequest>> emitters = new ConcurrentHashMap<>();

    /** 请求开始时注册发射回调；emitter 为 null 时注销（清理） */
    public void registerEmitter(String adkSessionId, Consumer<ConfirmRequest> emitter) {
        if (adkSessionId == null || adkSessionId.isEmpty()) {
            return;
        }
        if (emitter == null) {
            emitters.remove(adkSessionId);
        } else {
            emitters.put(adkSessionId, emitter);
        }
    }

    /**
     * 工具线程调用：发 confirm_request 并阻塞等待用户决定。
     *
     * @return true=放行执行；false=用户拒绝 / 等待超时 / 无发射通道（保守拒绝）
     */
    public boolean requestConfirm(String adkSessionId, String toolCallId, String command, String reason) {
        Consumer<ConfirmRequest> emitter = emitters.get(adkSessionId);
        if (emitter == null) {
            // 无事件通道（理论上不发生：注册先于工具执行）——保守拒绝，绝不静默放行写命令
            log.warn("确认门无发射通道，按拒绝处理 adkSessionId={} command=[{}]", adkSessionId, command);
            return false;
        }
        String confirmId = UUID.randomUUID().toString().replace("-", "");
        CompletableFuture<Boolean> future = new CompletableFuture<>();
        pending.put(confirmId, new Pending(future, adkSessionId));
        try {
            emitter.accept(new ConfirmRequest(confirmId, toolCallId, command, reason));
            log.info("确认门挂起等待用户决定 confirmId={} command=[{}] reason={}", confirmId, command, reason);
            boolean allowed = future.get(timeoutSeconds, TimeUnit.SECONDS);
            log.info("确认门收到决定 confirmId={} allowed={}", confirmId, allowed);
            return allowed;
        } catch (TimeoutException te) {
            log.warn("确认门等待超时（{}s）按拒绝处理 confirmId={} command=[{}]", timeoutSeconds, confirmId, command);
            return false;
        } catch (Exception e) {
            Thread.currentThread().interrupt();
            log.warn("确认门等待被中断，按拒绝处理 confirmId={}", confirmId);
            return false;
        } finally {
            pending.remove(confirmId);
        }
    }

    /**
     * confirm 端点调用：唤醒挂起的工具线程。
     *
     * @return 是否找到了等待中的确认（false=已超时清理或 confirmId 无效）
     */
    public boolean decide(String confirmId, boolean allow) {
        Pending p = confirmId == null ? null : pending.get(confirmId);
        if (p == null) {
            return false;
        }
        return p.future.complete(allow);
    }

    /**
     * 按会话批量取消：该会话所有挂起确认立即按拒绝唤醒（工具线程不再空等 120s）。
     *
     * <p>调用点：{@code AiCallNode} finally——请求结束（含客户端停止/断开导致的取消）时，
     * 该会话不可能再有人点击确认，残留挂起只会白白占住线程。
     */
    public void cancelSession(String adkSessionId) {
        if (adkSessionId == null || adkSessionId.isEmpty()) {
            return;
        }
        pending.forEach((confirmId, p) -> {
            if (adkSessionId.equals(p.adkSessionId) && p.future.complete(false)) {
                log.info("确认门随会话结束被取消，按拒绝唤醒 confirmId={} adkSessionId={}", confirmId, adkSessionId);
            }
        });
    }
}
