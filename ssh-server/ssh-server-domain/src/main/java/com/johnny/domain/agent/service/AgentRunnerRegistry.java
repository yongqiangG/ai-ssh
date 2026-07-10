package com.johnny.domain.agent.service;

import com.google.adk.agents.LlmAgent;
import com.google.adk.models.springai.SpringAI;
import com.google.adk.runner.InMemoryRunner;
import com.google.common.collect.ImmutableList;
import com.johnny.api.dto.AgentDTO;
import com.johnny.domain.agent.config.AiProperties;
import com.johnny.domain.agent.model.RunnerHolder;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Agent 装配注册中心 —— 启动时把 YAML 配置构建成可运行的 ADK Runner。
 *
 * <p><b>装配链（对应 WaLiSSH armory 责任链，此处压缩为一个方法）：</b>
 * <pre>
 * AiProperties
 *   ① OpenAiApi        （OpenAI 兼容端点客户端）          ← 对应 WaLiSSH AiApiNode
 *   ② OpenAiChatModel  （SpringAI 的 ChatModel 实现）     ← 对应 WaLiSSH ChatModelNode
 *   ③ new SpringAI(chatModel) （ADK↔SpringAI 桥接）       ← 关键：让 ADK 的 LlmAgent 能用 SpringAI 模型
 *   ④ LlmAgent         （instruction + 模型，无工具）     ← 对应 WaLiSSH AgentNode（裁掉工具挂载）
 *   ⑤ InMemoryRunner   （执行入口 + 会话服务）            ← 对应 WaLiSSH RunnerNode
 * </pre>
 *
 * <p><b>为何最小闭环可省略 WaLiSSH 的 6 节点 armory 责任链：</b>
 * 该责任链（RootNode→AiApiNode→ChatModelNode→AgentNode→AgentWorkflowNode→RunnerNode）本质是
 * 把 YAML 声明式配置逐节点解析装配。最小闭环只有一个 agent、无工具、无多 Agent 编排，
 * 故直接用顺序代码装配即可，等价但更直观。
 *
 * <p><b>关于桥接类：</b>WaLiSSH 用了自己魔改的 {@code MySpringAI}（替换 MessageConverter 等），
 * 但其 AgentNode 实际注入的是官方 {@link SpringAI}。最小闭环用官方 SpringAI 即可，无需 MySpringAI 补丁。
 */
@Slf4j
@Component
public class AgentRunnerRegistry implements ApplicationRunner {

    @Resource
    private AiProperties aiProperties;

    /** agentId → RunnerHolder，装配后只读 */
    private final Map<String, RunnerHolder> registry = new ConcurrentHashMap<>();

    @Override
    public void run(ApplicationArguments args) {
        build(aiProperties);
    }

    /**
     * 执行装配：构建并注册 Runner。
     * 装配阶段仅构建对象、不实际调用模型，故占位 api-key 不会在此报错（真实请求时才 401）。
     */
    private void build(AiProperties p) {
        AiProperties.Api api = p.getApi();
        AiProperties.Agent agentCfg = p.getAgent();

        if (api == null || agentCfg == null
                || StringUtils.isBlank(api.getBaseUrl())
                || StringUtils.isBlank(api.getApiKey())
                || StringUtils.isBlank(agentCfg.getId())) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "AI 配置缺失：请检查 application-dev.yml 的 ai.api / ai.agent");
        }

        // ① OpenAI 兼容端点客户端（completions-path 缺省 v1/chat/completions）
        // 关闭 glm-5.2 思考模式：SpringAI 标准请求体不含 thinking 字段，故用 RestClient 拦截器
        // 往 chat/completions 请求体注入 thinking.type=disabled → 无 reasoning_content、响应更快。
        org.springframework.http.client.ClientHttpRequestInterceptor disableThinking = (request, body, execution) -> {
            String path = request.getURI().getPath();
            if (path != null && path.contains("chat/completions") && body != null && body.length > 0) {
                try {
                    com.alibaba.fastjson2.JSONObject obj = com.alibaba.fastjson2.JSON.parseObject(
                            new String(body, java.nio.charset.StandardCharsets.UTF_8));
                    if (obj != null && !obj.containsKey("thinking")) {
                        com.alibaba.fastjson2.JSONObject thinking = new com.alibaba.fastjson2.JSONObject();
                        thinking.put("type", "disabled");
                        obj.put("thinking", thinking);
                        byte[] newBody = obj.toJSONString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                        request.getHeaders().setContentLength(newBody.length);
                        return execution.execute(request, newBody);
                    }
                } catch (Exception ignore) {
                    // 改写失败则沿用原 body
                }
            }
            return execution.execute(request, body);
        };
        OpenAiApi openAiApi = OpenAiApi.builder()
                .baseUrl(api.getBaseUrl())
                .apiKey(api.getApiKey())
                .completionsPath(StringUtils.isNotBlank(api.getCompletionsPath())
                        ? api.getCompletionsPath() : "v1/chat/completions")
                .restClientBuilder(org.springframework.web.client.RestClient.builder().requestInterceptor(disableThinking))
                .build();

        // ② SpringAI ChatModel（指定模型名）
        ChatModel chatModel = OpenAiChatModel.builder()
                .openAiApi(openAiApi)
                .defaultOptions(OpenAiChatOptions.builder()
                        .model(api.getModel())
                        .build())
                .build();

        // ③④ LlmAgent：通过 SpringAI 桥接接入模型，挂载 instruction（最小闭环不挂任何工具）
        LlmAgent llmAgent = LlmAgent.builder()
                .name(agentCfg.getName())
                .description(agentCfg.getDescription())
                .model(new SpringAI(chatModel))
                .instruction(agentCfg.getInstruction())
                .outputKey(agentCfg.getOutputKey())
                .build();

        // ⑤ InMemoryRunner：appName 作为会话命名空间；第三参为 plugins（最小闭环为空）
        String appName = agentCfg.getName();
        InMemoryRunner runner = new InMemoryRunner(llmAgent, appName, ImmutableList.of());

        RunnerHolder holder = RunnerHolder.builder()
                .agentId(agentCfg.getId())
                .appName(appName)
                .agentName(agentCfg.getName())
                .agentDesc(agentCfg.getDescription())
                .runner(runner)
                .build();

        registry.put(holder.getAgentId(), holder);
        log.info("AI Agent 装配完成 agentId={} appName={} model={}",
                holder.getAgentId(), appName, api.getModel());
    }

    /**
     * 按 agentId 取 RunnerHolder；不存在则抛 AppException。
     */
    public RunnerHolder get(String agentId) {
        RunnerHolder holder = registry.get(agentId);
        if (holder == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "智能体不存在: " + agentId);
        }
        return holder;
    }

    /**
     * 列出已装配智能体（供 /api/v1/agents 接口）。
     */
    public List<AgentDTO> listAgents() {
        return registry.values().stream()
                .map(h -> AgentDTO.builder()
                        .agentId(h.getAgentId())
                        .agentName(h.getAgentName())
                        .agentDesc(h.getAgentDesc())
                        .build())
                .collect(Collectors.toList());
    }
}
