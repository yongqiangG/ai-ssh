package com.johnny.domain.react;

import lombok.Data;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;

/**
 * ReAct 执行的动态上下文 —— 在责任链各节点间透传的可变状态。
 *
 * <p>对应 WaLiSSH 的 {@code DefaultReActFactory.DynamicContext}，这里裁剪为最小闭环所需字段。
 * 由 {@code ChatController.chat_stream} 创建（填入 emitter 等），传给 {@code RootNode.apply}，
 * 之后随 {@code router} 递归一路透传。
 */
@Data
public class ReActContext {

    /** ADK 会话 ID */
    private String sessionId;

    /** 用户 ID */
    private String userId;

    /** 智能体 ID */
    private String agentId;

    /** 本轮用户消息 */
    private String message;

    /** SSE/NDJSON 发射器（向客户端推送 ReAct 事件） */
    private ResponseBodyEmitter emitter;

    /** 当前已执行步数（一次 runAsync 算一步） */
    private int step;

    /** 最大步数熔断（最小闭环单步即结束，预留） */
    private int maxSteps = 50;

    /** 累积的助手回复文本（流式拼接，供 fullText 推送） */
    private final StringBuilder assistantContent = new StringBuilder();
}
