package com.johnny.domain.agent.armory;

import org.junit.Before;
import org.junit.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.ai.tool.function.FunctionToolCallback;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

/**
 * LLM 端点手动连通性测试——复用 {@link AiApiNode} / {@link ChatModelNode} 的构建方式
 * （OpenAiApi + OpenAiChatModel，base-url / api-key / completions-path / model 四件套，
 * 与客户端「模型设置」弹窗字段一一对应），绕过 ADK 会话/装配链路，直接验证端点可用性。
 *
 * <p>未提供 api-key 时自动跳过（Assume），不影响常规 {@code mvn test}。运行方式：
 * <pre>
 * cd ssh-server
 * mvn -pl ssh-server-domain -Dtest=LlmEndpointManualTest -Dllm.api-key=sk-xxx test
 * # 可选覆盖（默认值即当前「模型设置」里的配置）：
 * #   -Dllm.base-url=https://wzw.pp.ua
 * #   -Dllm.model=deepseek-v4-pro
 * #   -Dllm.completions-path=/v1/chat/completions
 * </pre>
 *
 * <p>注：省略了 AiApiNode 的 disableThinking 拦截器——它只对模型名含 glm 的请求注入
 * thinking.type=disabled，对 deepseek / gpt 类模型无影响；若用本测试验证 GLM 需留意该差异。
 */
public class LlmEndpointManualTest {

    private String model;
    private OpenAiChatModel chatModel;

    @Before
    public void setUp() {
        // 端点四件套一律从 -D 系统属性或环境变量读取，禁止在源码中硬编码 api-key。
        // 常用端点示例（key 自备）：
        //   deepseek 中转: base-url=https://wzw.pp.ua           model=deepseek-ai/deepseek-v4-pro completions-path=/v1/chat/completions
        //   智谱 GLM:     base-url=https://open.bigmodel.cn     model=glm-5.2                     completions-path=/api/coding/paas/v4/chat/completions
        //   gpt 中转:     base-url=https://welfare.0xpsyche.me  model=gpt-5.6-sol                 completions-path=/v1/chat/completions
        String baseUrl = prop("llm.base-url", "LLM_BASE_URL", "https://elysiver.h-e.top");
        String apiKey = prop("llm.api-key", "LLM_API_KEY", "");
        String completionsPath = prop("llm.completions-path", "LLM_COMPLETIONS_PATH", "/v1/chat/completions");
        model = prop("llm.model", "LLM_MODEL", "deepseek-v4-pro");

        assumeTrue("未提供 api-key（-Dllm.api-key=xxx 或环境变量 LLM_API_KEY），跳过端点测试", !apiKey.isBlank());

        // 与 AiApiNode.doApply 相同的构建链
        OpenAiApi openAiApi = OpenAiApi.builder()
                .baseUrl(baseUrl)
                .apiKey(apiKey)
                .completionsPath(completionsPath)
                .build();
        // 与 ChatModelNode.doApply 相同的构建链
        chatModel = OpenAiChatModel.builder()
                .openAiApi(openAiApi)
                .defaultOptions(OpenAiChatOptions.builder().model(model).build())
                .build();

        System.out.printf("[llm-test] baseUrl=%s completionsPath=%s model=%s%n", baseUrl, completionsPath, model);
    }

    /** 基础对话：验证端点连通、api-key、模型名三件事。 */
    @Test
    public void chat_basic() {
        ChatResponse response = chatModel.call(new Prompt("请只回复两个字：收到"));

        assertNotNull("ChatResponse 为 null", response);
        String text = response.getResult().getOutput().getText();
        System.out.println("[llm-test] 模型回复: " + text);
        printUsage(response);
        assertNotNull("模型回复文本为 null", text);
        assertFalse("模型回复为空", text.isBlank());
    }

    /**
     * function calling：agent 强依赖 executeCommand 工具，验证该端点/模型支持 OpenAI tools 协议。
     * internalToolExecutionEnabled(false) 与线上行为一致（vendored MySpringAI 关闭了 SpringAI
     * 内部工具执行、由 ADK 编排），因此只断言模型返回 tool_calls，不实际执行工具。
     */
    @Test
    public void chat_toolCall() {
        FunctionToolCallback<CommandInput, String> tool = FunctionToolCallback
                .builder("executeCommand", (CommandInput in) -> "ok")
                .description("在远程服务器执行 shell 命令并返回输出")
                .inputType(CommandInput.class)
                .build();

        OpenAiChatOptions options = OpenAiChatOptions.builder()
                .model(model)
                .toolCallbacks(tool)
                .internalToolExecutionEnabled(false)
                .build();

        ChatResponse response = chatModel.call(new Prompt("帮我看下服务器磁盘占用情况", options));

        AssistantMessage output = response.getResult().getOutput();
        System.out.println("[llm-test] hasToolCalls=" + output.hasToolCalls()
                + " toolCalls=" + output.getToolCalls() + " text=" + output.getText());
        printUsage(response);
        assertTrue("模型未返回 tool_calls：该端点/模型可能不支持 function calling，agent 的工具调用将失效",
                output.hasToolCalls());
    }

    private void printUsage(ChatResponse response) {
        try {
            var usage = response.getMetadata().getUsage();
            System.out.printf("[llm-test] tokens: prompt=%s completion=%s total=%s%n",
                    usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
        } catch (Exception ignore) {
            // 部分中转不返回 usage，忽略
        }
    }

    private static String prop(String sysKey, String envKey, String def) {
        String v = System.getProperty(sysKey);
        if (v == null || v.isBlank()) {
            v = System.getenv(envKey);
        }
        return v == null || v.isBlank() ? def : v;
    }

    /** executeCommand 工具入参（仅用于生成 tools 的 JSON Schema）。 */
    public static class CommandInput {
        public String command;
    }
}
