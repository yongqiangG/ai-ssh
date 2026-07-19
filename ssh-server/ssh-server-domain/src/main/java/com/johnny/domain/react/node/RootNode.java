package com.johnny.domain.react.node;

import com.johnny.api.dto.ChatRequestDTO;
import com.johnny.api.dto.ReActResultDTO;
import com.johnny.domain.react.ReActContext;
import com.johnny.domain.react.engine.StrategyHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * ReAct 根节点 —— 责任链入口。
 *
 * <p>职责：从 {@link ChatRequestDTO} 把字段填入 {@link ReActContext}，重置累积缓冲，然后 {@code router} 推进到 AiCallNode。
 * 对应 WaLiSSH {@code RootNode}（裁掉了历史消息加载、终端绑定——最小闭环不需要）。
 */
@Slf4j
@Component("reactRootNode")
public class RootNode extends AbstractReActSupport {

    @Override
    protected ReActResultDTO doApply(ChatRequestDTO req, ReActContext ctx) throws Exception {
        // 初始化上下文（emitter 已由 Controller 创建时塞入）
        ctx.setSessionId(req.getSessionId());
        ctx.setUserId(req.getUserId());
        ctx.setAgentId(req.getAgentId());
        ctx.setMessage(req.getMessage());
        ctx.setTerminalSessionId(req.getTerminalSessionId());
        ctx.setThinkingEnabled(Boolean.TRUE.equals(req.getThinkingEnabled()));
        log.info("ReAct RootNode 收到 terminalSessionId={} thinkingEnabled={}",
                req.getTerminalSessionId(), ctx.isThinkingEnabled());
        ctx.setStep(0);
        ctx.getAssistantContent().setLength(0);

        log.info("ReAct RootNode 初始化完成 sessionId={} agentId={}", req.getSessionId(), req.getAgentId());

        // 推进到 AI 调用节点
        return router(req, ctx);
    }

    /** 固定路由到 AiCallNode。 */
    @Override
    public StrategyHandler<ChatRequestDTO, ReActContext, ReActResultDTO> get(ChatRequestDTO req, ReActContext ctx) {
        return getBean("reactAiCallNode");
    }
}
