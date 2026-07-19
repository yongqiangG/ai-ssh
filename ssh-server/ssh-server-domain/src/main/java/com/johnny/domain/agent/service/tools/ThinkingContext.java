package com.johnny.domain.agent.service.tools;

/**
 * 消息级「深度思考」开关的进程内传递（D1 方案）。
 *
 * <p>思考参数最终要注入到 chat/completions 请求体，但注入点（{@code AiApiNode} 构建
 * OpenAiApi 时绑定的 RestClient 拦截器）是 armory 装配期的静态产物，拿不到请求级信息；
 * 池化线程又让 ThreadLocal 不可靠（见 {@link TerminalContext} 的教训）。故用全局
 * volatile 标志：{@code AiCallNode} 在 runAsync 前置位、finally 复位，拦截器读取。
 *
 * <p><b>正确性前提：</b>同一时刻只有一条 chat_stream 在跑——当前由前端全局
 * {@code sending} 锁保证。若将来支持并发对话，需升级为双 Runner 路由（armory 装配
 * 带/不带思考注入的两套管道，共享同一 SessionService），本类即可删除。
 * 失效后果良性：并发时某条请求思考模式取错，仅影响该条回复的延迟/深度，无数据错误。
 */
public final class ThinkingContext {

    private static volatile boolean thinkingEnabled = false;

    private ThinkingContext() {
    }

    public static void set(boolean enabled) {
        thinkingEnabled = enabled;
    }

    public static boolean isEnabled() {
        return thinkingEnabled;
    }
}
