package com.johnny.domain.agent.armory;

import com.johnny.domain.agent.config.AgentConfigProperties;
import com.johnny.domain.react.engine.StrategyHandler;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;
import org.springframework.ai.openai.api.OpenAiApi;

/**
 * 构建 {@link OpenAiApi}（base-url / api-key / completions-path）。
 *
 * <p>历史：thinking 开关曾在此以 RestClient 拦截器改写请求体注入（disableThinking），
 * 但流式请求走 WebClient，拦截器对其从未生效（260723 核实）——注入已整体迁移至
 * {@code MySpringAI.injectThinkingOptions}（OpenAiChatOptions.extraBody，双路径统一生效）。
 */
@Slf4j
@Component("armoryAiApiNode")
public class AiApiNode extends AbstractArmoryNode {

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentConfigProperties.Module.AiApi apiCfg = ctx.getTable().getModule().getAiApi();
        if (apiCfg == null || StringUtils.isBlank(apiCfg.getApiKey())) {
            // api-key 为空快速失败（Q10）：dev 必须配 ZHIPU_API_KEY
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "armory 装配失败：ai-api.api-key 为空，请配置 ZHIPU_API_KEY");
        }

        OpenAiApi openAiApi = OpenAiApi.builder()
                .baseUrl(apiCfg.getBaseUrl())
                .apiKey(apiCfg.getApiKey())
                .completionsPath(StringUtils.isNotBlank(apiCfg.getCompletionsPath())
                        ? apiCfg.getCompletionsPath() : "v1/chat/completions")
                .build();
        ctx.setOpenAiApi(openAiApi);
        log.info("armory[AiApiNode] 完成 baseUrl={} completionsPath={}",
                apiCfg.getBaseUrl(), apiCfg.getCompletionsPath());
        return router(p, ctx);
    }

    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryChatModelNode");
    }
}
