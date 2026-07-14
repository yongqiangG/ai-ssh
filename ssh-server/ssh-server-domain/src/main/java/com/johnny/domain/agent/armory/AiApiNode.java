package com.johnny.domain.agent.armory;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.johnny.domain.agent.config.AgentConfigProperties;
import com.johnny.domain.react.engine.StrategyHandler;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.ai.openai.api.OpenAiApi;

import java.nio.charset.StandardCharsets;

/**
 * 构建 {@link OpenAiApi}（base-url / api-key / completions-path）。
 *
 * <p>{@code disableThinking} 拦截器（关闭 GLM 思考模式）从原 {@code AgentRunnerRegistry.build} 迁入此处——
 * 构建 OpenAiApi 的职责在它身上（Q5）。
 *
 * <p>联调实测（2026-07-14）：disableThinking 注入 thinking.type=disabled 后，GLM-5.2 响应确认
 * 无 reasoning_content（思考已关闭）。
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
                .restClientBuilder(RestClient.builder().requestInterceptor(buildDisableThinkingInterceptor()))
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

    /**
     * 关闭 glm-5.2 思考模式：SpringAI 标准请求体不含 thinking 字段，用 RestClient 拦截器往
     * chat/completions 请求体注入 thinking.type=disabled → 无 reasoning_content、响应更快。
     */
    private ClientHttpRequestInterceptor buildDisableThinkingInterceptor() {
        return (request, body, execution) -> {
            String path = request.getURI().getPath();
            if (path != null && path.contains("chat/completions") && body != null && body.length > 0) {
                try {
                    JSONObject obj = JSON.parseObject(new String(body, StandardCharsets.UTF_8));
                    // 只对 GLM 系列模型注入 thinking.type=disabled（关闭思考）；gpt 等其它模型注入
                    // 未知字段 thinking 会触发 400，必须跳过（模型可插拔兼容）。
                    String model = obj == null ? null : obj.getString("model");
                    boolean isGlm = model != null && model.toLowerCase().contains("glm");
                    if (isGlm && !obj.containsKey("thinking")) {
                        JSONObject thinking = new JSONObject();
                        thinking.put("type", "disabled");
                        obj.put("thinking", thinking);
                        byte[] newBody = obj.toJSONString().getBytes(StandardCharsets.UTF_8);
                        request.getHeaders().setContentLength(newBody.length);
                        return execution.execute(request, newBody);
                    }
                } catch (Exception ignore) {
                    // 改写失败则沿用原 body
                }
            }
            return execution.execute(request, body);
        };
    }
}
