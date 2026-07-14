package com.johnny.domain.agent.armory;

import com.johnny.domain.agent.config.AgentConfigProperties;
import com.johnny.domain.agent.config.AgentConfigProperties.AgentTable;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * armory 装配工厂：遍历配置里的每个 agent table，发起一条装配责任链。
 *
 * <p>由瘦身后 {@code AgentRunnerRegistry.build()} 调用（§4.5.2）。
 */
@Slf4j
@Component
public class DefaultArmoryFactory {

    @Resource
    private ArmoryRootNode armoryRootNode;
    @Resource
    private AgentConfigProperties agentConfigProperties;

    public void assembleAll() throws Exception {
        // ⚠️ 启动健壮性：prod 不挂 ssh-agent.yml（Q10：只挂 dev）时 tables 为 null/空，
        // 必须跳过装配、不影响启动；否则 getTables().values() 会 NPE 搞死 prod 启动。
        if (agentConfigProperties.getTables() == null || agentConfigProperties.getTables().isEmpty()) {
            log.warn("armory 跳过装配：ai.agent.config.tables 为空（ssh-agent.yml 未挂载——prod 正常；dev 请检查 application-dev.yml 的 spring.config.import）");
            return;
        }
        for (AgentTable table : agentConfigProperties.getTables().values()) {
            ArmoryDynamicContext ctx = new ArmoryDynamicContext();
            ctx.setTable(table);
            armoryRootNode.apply(null, ctx);   // 入口 apply 触发整条链
            log.info("armory 装配完成 agentId={}", table.getAgent().getAgentId());
        }
    }
}
