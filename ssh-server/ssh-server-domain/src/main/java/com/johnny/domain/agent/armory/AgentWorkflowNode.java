package com.johnny.domain.agent.armory;

import com.johnny.domain.react.engine.StrategyHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 显式占位节点：单 agent 场景直接透传 llmAgent。
 *
 * <p>多 Agent 编排（Loop / Parallel / Sequential）预留——当前直通。
 */
@Slf4j
@Component("armoryAgentWorkflowNode")
public class AgentWorkflowNode extends AbstractArmoryNode {

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        ctx.setWorkflowAgent(ctx.getLlmAgent());   // 直通
        log.info("armory[AgentWorkflowNode] 直通（单 agent，多 agent 编排预留）");
        return router(p, ctx);
    }

    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryRunnerNode");
    }
}
