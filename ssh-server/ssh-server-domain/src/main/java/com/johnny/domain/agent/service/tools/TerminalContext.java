package com.johnny.domain.agent.service.tools;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 终端会话绑定上下文（Q2 最终落地方案：按 ADK sessionId 的注册表）。
 *
 * <p><b>为何放弃 InheritableThreadLocal：</b>流式 SSE 模式下，ADK 经 RxJava 调度器在池化线程
 * （如 {@code HttpClient-1-Worker-*}）执行工具，而 InheritableThreadLocal 只在线程<b>创建时</b>
 * 继承，池化线程复用继承不到 → terminalSessionId 丢失（联调实测：工具入口线程
 * {@code HttpClient-1-Worker-2}，ITL 取到 {@code null}）。
 *
 * <p>改为按 ADK sessionId（会话级，runAsync 全程不变）注册，工具经 {@code ToolContext}
 * 拿到 {@code invocationContext().session().id()} 查询，彻底不依赖线程继承。
 *
 * <p>注册/清理：{@code AiCallNode} 调 runAsync 前 {@link #register}，结束后 {@link #register}(id, null)。
 */
public final class TerminalContext {

    /** ADK sessionId → 终端 terminalSessionId */
    private static final Map<String, String> SESSION_TERMINALS = new ConcurrentHashMap<>();

    private TerminalContext() {
    }

    /**
     * 注册绑定（terminalSessionId 为 null/空时移除，用于清理）。
     */
    public static void register(String adkSessionId, String terminalSessionId) {
        if (adkSessionId == null || adkSessionId.isEmpty()) {
            return;
        }
        if (terminalSessionId == null || terminalSessionId.isEmpty()) {
            SESSION_TERMINALS.remove(adkSessionId);
        } else {
            SESSION_TERMINALS.put(adkSessionId, terminalSessionId);
        }
    }

    /**
     * 工具按 ADK sessionId 查询绑定的终端 sessionId。
     */
    public static String getTerminalSessionId(String adkSessionId) {
        if (adkSessionId == null || adkSessionId.isEmpty()) {
            return null;
        }
        return SESSION_TERMINALS.get(adkSessionId);
    }
}
