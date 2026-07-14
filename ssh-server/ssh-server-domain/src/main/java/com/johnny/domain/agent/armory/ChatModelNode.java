package com.johnny.domain.agent.armory;

import com.johnny.domain.agent.config.AgentConfigProperties;
import com.johnny.domain.react.engine.StrategyHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.stereotype.Component;

/**
 * 构建 {@link ChatModel}（OpenAiChatModel + 模型名）。MCP / skills 等扩展预留位。
 *
 * <p>注：{@code AgentConfigProperties.Module.ChatModel}（配置类）与 {@code org.springframework.ai.chat.model.ChatModel}
 * （Spring AI）同名——本类 import Spring AI 的，配置类用全限定 {@code AgentConfigProperties.Module.ChatModel} 引用。
 */
@Slf4j
@Component("armoryChatModelNode")
public class ChatModelNode extends AbstractArmoryNode {

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentConfigProperties.Module.ChatModel cmCfg = ctx.getTable().getModule().getChatModel();
        ChatModel chatModel = OpenAiChatModel.builder()
                .openAiApi(ctx.getOpenAiApi())
                .defaultOptions(OpenAiChatOptions.builder()
                        .model(cmCfg.getModel())
                        .build())
                .build();
        ctx.setChatModel(chatModel);
        log.info("armory[ChatModelNode] 完成 model={}", cmCfg.getModel());
        return router(p, ctx);
    }

    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryAgentNode");
    }
}
