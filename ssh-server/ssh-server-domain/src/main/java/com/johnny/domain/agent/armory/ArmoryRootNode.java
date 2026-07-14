package com.johnny.domain.agent.armory;

import com.johnny.domain.react.engine.StrategyHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * armory 装配责任链入口（对应 WaLiSSH ArmoryRootNode）。
 *
 * <p>bean 名 {@code armoryRootNode}，与 react 包 {@code reactRootNode} 区分（避免注入歧义）。
 * 职责：记录装配开始日志，{@code router} 推进到 AiApiNode。
 */
@Slf4j
@Component("armoryRootNode")
public class ArmoryRootNode extends AbstractArmoryNode {

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        log.info("armory 装配开始 agentId={} appName={}",
                ctx.getTable().getAgent().getAgentId(),
                ctx.getTable().getAgent().getAgentName());
        return router(p, ctx);
    }

    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryAiApiNode");
    }
}
