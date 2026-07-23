package com.johnny.domain.agent.service.tools;

import java.util.function.Consumer;

/**
 * 深度思考过程（reasoning_content）的进程内旁路传递（260723 决议 8）。
 *
 * <p>思维链片段产生在 SpringAI 流式回调线程（{@code MySpringAI.generateStreamingContent}），
 * 而 NDJSON emitter 在 {@code AiCallNode} 手里；且 reasoning 刻意不进 ADK Content/session——
 * 否则下一轮拼接时 {@code MessageConverter.handleAssistantContent} 会把思考文本混入
 * assistant 正文污染上下文。故走与 {@link ThinkingContext} 同款的全局旁路：
 * {@code AiCallNode} 请求开始时注册 consumer、finally 注销，桥接层逐片段推送。
 *
 * <p><b>正确性前提：</b>同一时刻只有一条 chat_stream 在跑（与 {@link ThinkingContext} 相同，
 * 由前端全局 {@code sending} 锁保证）。失效后果良性：并发时思考片段可能串到别的流，
 * 仅影响展示，不影响正文与工具执行。
 */
public final class ReasoningRelay {

    private static volatile Consumer<String> consumer;

    private ReasoningRelay() {
    }

    /** 请求开始时注册片段消费者；传 null 注销（AiCallNode finally 清理） */
    public static void register(Consumer<String> c) {
        consumer = c;
    }

    /** 桥接层推送一个思考片段；无消费者或片段为空时静默丢弃（旁路不影响正文流） */
    public static void emit(String delta) {
        Consumer<String> c = consumer;
        if (c != null && delta != null && !delta.isEmpty()) {
            c.accept(delta);
        }
    }
}
