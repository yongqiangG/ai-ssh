package com.johnny.domain.agent.armory;

import com.johnny.domain.agent.config.AgentConfigProperties;
import com.johnny.domain.react.engine.StrategyHandler;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

/**
 * 构建 {@link OpenAiApi}（base-url / api-key / completions-path + 双路超时）。
 *
 * <p>超时（260724 审计 Q1）：LLM 服务半死（TCP 通但不回数据）时，无超时的
 * blockingIterable 会永久阻塞 ReAct 线程——emitter 10min 超时只置取消标志，
 * 阻塞中的线程看不到；悬挂线程累积耗尽有界线程池后所有对话「服务繁忙」，
 * 只能重启。故两条路径都配超时，超时异常走 LlmErrorHumanizer → LLM_TIMEOUT
 * → 前端人话 + 重试，线程正常退回池。
 * <ul>
 *   <li>流式（WebClient + reactor-netty）：连接 10s + <b>读空闲</b> 180s——
 *       ReadTimeoutHandler 计时的是相邻 chunk 的间隔而非整个响应，深度思考的
 *       长回复不受影响；</li>
 *   <li>非流式（RestClient + SimpleClientHttpRequestFactory）：连接 10s +
 *       socket read 180s。</li>
 * </ul>
 *
 * <p>历史：thinking 开关曾在此以 RestClient 拦截器改写请求体注入（disableThinking），
 * 但流式请求走 WebClient，拦截器对其从未生效（260723 核实）——注入已整体迁移至
 * {@code MySpringAI.injectThinkingOptions}（OpenAiChatOptions.extraBody，双路径统一生效）。
 */
@Slf4j
@Component("armoryAiApiNode")
public class AiApiNode extends AbstractArmoryNode {

    /** TCP 连接建立上限（毫秒） */
    private static final int CONNECT_TIMEOUT_MS = 10_000;

    /** 读空闲上限（秒）：流式为相邻 chunk 间隔，非流式为 socket read */
    private static final int READ_IDLE_TIMEOUT_S = 180;

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentConfigProperties.Module.AiApi apiCfg = ctx.getTable().getModule().getAiApi();
        if (apiCfg == null || StringUtils.isBlank(apiCfg.getApiKey())) {
            // api-key 为空快速失败（Q10）：dev 必须配 ZHIPU_API_KEY
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "armory 装配失败：ai-api.api-key 为空，请配置 ZHIPU_API_KEY");
        }

        HttpClient nettyClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, CONNECT_TIMEOUT_MS)
                .doOnConnected(conn ->
                        conn.addHandlerLast(new ReadTimeoutHandler(READ_IDLE_TIMEOUT_S)));
        WebClient.Builder webClientBuilder = WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(nettyClient));

        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(CONNECT_TIMEOUT_MS);
        requestFactory.setReadTimeout(READ_IDLE_TIMEOUT_S * 1000);
        RestClient.Builder restClientBuilder = RestClient.builder()
                .requestFactory(requestFactory);

        OpenAiApi openAiApi = OpenAiApi.builder()
                .baseUrl(apiCfg.getBaseUrl())
                .apiKey(apiCfg.getApiKey())
                .completionsPath(StringUtils.isNotBlank(apiCfg.getCompletionsPath())
                        ? apiCfg.getCompletionsPath() : "v1/chat/completions")
                .webClientBuilder(webClientBuilder)
                .restClientBuilder(restClientBuilder)
                .build();
        ctx.setOpenAiApi(openAiApi);
        log.info("armory[AiApiNode] 完成 baseUrl={} completionsPath={} connectTimeout={}ms readIdleTimeout={}s",
                apiCfg.getBaseUrl(), apiCfg.getCompletionsPath(), CONNECT_TIMEOUT_MS, READ_IDLE_TIMEOUT_S);
        return router(p, ctx);
    }

    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryChatModelNode");
    }
}
