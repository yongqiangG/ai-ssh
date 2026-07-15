package com.johnny.domain.agent.armory;

import com.johnny.domain.agent.config.AgentConfigProperties;
import com.johnny.domain.agent.config.AgentConfigProperties.AgentTable;
import com.johnny.domain.agent.model.LlmConfigEntity;
import com.johnny.domain.agent.service.ILlmConfigService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * armory 装配工厂：遍历配置中的 agent table，发起装配责任链。
 */
@Slf4j
@Component
public class DefaultArmoryFactory {

    @Resource
    private ArmoryRootNode armoryRootNode;
    @Resource
    private AgentConfigProperties agentConfigProperties;
    @Resource
    private Environment environment;
    @Resource
    private ILlmConfigService llmConfigService;

    public void assembleAll() throws Exception {
        if (agentConfigProperties.getTables() == null || agentConfigProperties.getTables().isEmpty()) {
            log.warn("armory 跳过装配：ai.agent.config.tables 为空");
            return;
        }
        for (AgentTable table : agentConfigProperties.getTables().values()) {
            applySingleLlmConfig(table);
            ArmoryDynamicContext ctx = new ArmoryDynamicContext();
            ctx.setTable(table);
            armoryRootNode.apply(null, ctx);
            log.info("armory 装配完成 agentId={}", table.getAgent().getAgentId());
        }
    }

    private void applySingleLlmConfig(AgentTable table) {
        if (!environment.acceptsProfiles(Profiles.of("single"))) {
            return;
        }
        LlmConfigEntity config = llmConfigService.getDefaultConfig();
        table.getModule().getAiApi().setBaseUrl(config.getBaseUrl());
        table.getModule().getAiApi().setApiKey(config.getApiKey());
        table.getModule().getAiApi().setCompletionsPath(config.getCompletionsPath());
        table.getModule().getChatModel().setModel(config.getModel());
        log.info("single 模式使用本地 LLM 配置 provider={} model={}", config.getProviderName(), config.getModel());
    }
}
