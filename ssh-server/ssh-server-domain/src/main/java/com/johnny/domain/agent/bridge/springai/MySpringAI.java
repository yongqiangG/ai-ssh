/*
 * Decompiled with CFR 0.152.
 */
package com.johnny.domain.agent.bridge.springai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.adk.models.BaseLlm;
import com.google.adk.models.BaseLlmConnection;
import com.google.adk.models.LlmRequest;
import com.google.adk.models.LlmResponse;
import com.johnny.domain.agent.bridge.springai.MessageConverter;
import com.johnny.domain.agent.bridge.springai.error.SpringAIErrorMapper;
import com.johnny.domain.agent.bridge.springai.observability.SpringAIObservabilityHandler;
import com.johnny.domain.agent.bridge.springai.properties.SpringAIProperties;
import com.johnny.domain.agent.service.tools.ReasoningRelay;
import com.johnny.domain.agent.service.tools.ThinkingContext;
import com.google.genai.types.Content;
import com.google.genai.types.Part;
import io.reactivex.rxjava3.core.BackpressureStrategy;
import io.reactivex.rxjava3.core.Flowable;
import io.reactivex.rxjava3.schedulers.Schedulers;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.StreamingChatModel;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import org.springframework.ai.openai.OpenAiChatOptions;
import reactor.core.publisher.Flux;

public class MySpringAI
extends BaseLlm {
    private final ChatModel chatModel;
    private final StreamingChatModel streamingChatModel;
    private final ObjectMapper objectMapper;
    private final MessageConverter messageConverter;
    private final SpringAIObservabilityHandler observabilityHandler;

    public MySpringAI(ChatModel chatModel) {
        super(MySpringAI.extractModelName(chatModel));
        this.chatModel = Objects.requireNonNull(chatModel, "chatModel cannot be null");
        this.streamingChatModel = chatModel instanceof StreamingChatModel ? chatModel : null;
        this.objectMapper = new ObjectMapper();
        this.messageConverter = new MessageConverter(this.objectMapper);
        this.observabilityHandler = new SpringAIObservabilityHandler(this.createDefaultObservabilityConfig());
    }

    public MySpringAI(ChatModel chatModel, String modelName) {
        super(Objects.requireNonNull(modelName, "model name cannot be null"));
        this.chatModel = Objects.requireNonNull(chatModel, "chatModel cannot be null");
        this.streamingChatModel = chatModel instanceof StreamingChatModel ? chatModel : null;
        this.objectMapper = new ObjectMapper();
        this.messageConverter = new MessageConverter(this.objectMapper);
        this.observabilityHandler = new SpringAIObservabilityHandler(this.createDefaultObservabilityConfig());
    }

    public MySpringAI(StreamingChatModel streamingChatModel) {
        super(MySpringAI.extractModelName(streamingChatModel));
        this.chatModel = streamingChatModel instanceof ChatModel ? (ChatModel)streamingChatModel : null;
        this.streamingChatModel = Objects.requireNonNull(streamingChatModel, "streamingChatModel cannot be null");
        this.objectMapper = new ObjectMapper();
        this.messageConverter = new MessageConverter(this.objectMapper);
        this.observabilityHandler = new SpringAIObservabilityHandler(this.createDefaultObservabilityConfig());
    }

    public MySpringAI(StreamingChatModel streamingChatModel, String modelName) {
        super(Objects.requireNonNull(modelName, "model name cannot be null"));
        this.chatModel = streamingChatModel instanceof ChatModel ? (ChatModel)streamingChatModel : null;
        this.streamingChatModel = Objects.requireNonNull(streamingChatModel, "streamingChatModel cannot be null");
        this.objectMapper = new ObjectMapper();
        this.messageConverter = new MessageConverter(this.objectMapper);
        this.observabilityHandler = new SpringAIObservabilityHandler(this.createDefaultObservabilityConfig());
    }

    public MySpringAI(ChatModel chatModel, StreamingChatModel streamingChatModel, String modelName) {
        super(Objects.requireNonNull(modelName, "model name cannot be null"));
        this.chatModel = Objects.requireNonNull(chatModel, "chatModel cannot be null");
        this.streamingChatModel = Objects.requireNonNull(streamingChatModel, "streamingChatModel cannot be null");
        this.objectMapper = new ObjectMapper();
        this.messageConverter = new MessageConverter(this.objectMapper);
        this.observabilityHandler = new SpringAIObservabilityHandler(this.createDefaultObservabilityConfig());
    }

    public MySpringAI(ChatModel chatModel, StreamingChatModel streamingChatModel, String modelName, SpringAIProperties.Observability observabilityConfig) {
        super(Objects.requireNonNull(modelName, "model name cannot be null"));
        this.chatModel = Objects.requireNonNull(chatModel, "chatModel cannot be null");
        this.streamingChatModel = Objects.requireNonNull(streamingChatModel, "streamingChatModel cannot be null");
        this.objectMapper = new ObjectMapper();
        this.messageConverter = new MessageConverter(this.objectMapper);
        this.observabilityHandler = new SpringAIObservabilityHandler(Objects.requireNonNull(observabilityConfig, "observabilityConfig cannot be null"));
    }

    public MySpringAI(ChatModel chatModel, String modelName, SpringAIProperties.Observability observabilityConfig) {
        super(Objects.requireNonNull(modelName, "model name cannot be null"));
        this.chatModel = Objects.requireNonNull(chatModel, "chatModel cannot be null");
        this.streamingChatModel = chatModel instanceof StreamingChatModel ? chatModel : null;
        this.objectMapper = new ObjectMapper();
        this.messageConverter = new MessageConverter(this.objectMapper);
        this.observabilityHandler = new SpringAIObservabilityHandler(Objects.requireNonNull(observabilityConfig, "observabilityConfig cannot be null"));
    }

    public MySpringAI(StreamingChatModel streamingChatModel, String modelName, SpringAIProperties.Observability observabilityConfig) {
        super(Objects.requireNonNull(modelName, "model name cannot be null"));
        this.chatModel = streamingChatModel instanceof ChatModel ? (ChatModel)streamingChatModel : null;
        this.streamingChatModel = Objects.requireNonNull(streamingChatModel, "streamingChatModel cannot be null");
        this.objectMapper = new ObjectMapper();
        this.messageConverter = new MessageConverter(this.objectMapper);
        this.observabilityHandler = new SpringAIObservabilityHandler(Objects.requireNonNull(observabilityConfig, "observabilityConfig cannot be null"));
    }

    public Flowable<LlmResponse> generateContent(LlmRequest llmRequest, boolean stream) {
        if (stream) {
            if (this.streamingChatModel == null) {
                return Flowable.error((Throwable)new IllegalStateException("StreamingChatModel is not configured"));
            }
            return this.generateStreamingContent(llmRequest);
        }
        if (this.chatModel == null) {
            return Flowable.error((Throwable)new IllegalStateException("ChatModel is not configured"));
        }
        return this.generateContent(llmRequest);
    }

    private Flowable<LlmResponse> generateContent(LlmRequest llmRequest) {
        SpringAIObservabilityHandler.RequestContext context = this.observabilityHandler.startRequest(this.model(), "chat");
        try {
            Prompt prompt = this.injectThinkingOptions(this.messageConverter.toLlmPrompt(llmRequest));
            this.observabilityHandler.logRequest(prompt.toString(), this.model());
            ChatResponse chatResponse = this.chatModel.call(prompt);
            LlmResponse llmResponse = this.messageConverter.toLlmResponse(chatResponse);
            this.observabilityHandler.logResponse(this.extractTextFromResponse(llmResponse), this.model());
            int totalTokens = this.extractTokenCount(chatResponse);
            int inputTokens = this.extractInputTokenCount(chatResponse);
            int outputTokens = this.extractOutputTokenCount(chatResponse);
            this.observabilityHandler.recordSuccess(context, totalTokens, inputTokens, outputTokens);
            return Flowable.just(llmResponse);
        }
        catch (Exception e) {
            this.observabilityHandler.recordError(context, e);
            SpringAIErrorMapper.MappedError mappedError = SpringAIErrorMapper.mapError(e);
            return Flowable.error((Throwable)new RuntimeException(mappedError.getNormalizedMessage(), e));
        }
    }

    private Flowable<LlmResponse> generateStreamingContent(LlmRequest llmRequest) {
        SpringAIObservabilityHandler.RequestContext context = this.observabilityHandler.startRequest(this.model(), "streaming");
        return Flowable.<LlmResponse>create(emitter -> {
            try {
                Prompt prompt = this.injectThinkingOptions(this.messageConverter.toLlmPrompt(llmRequest));
                this.observabilityHandler.logRequest(prompt.toString(), this.model());
                Flux<ChatResponse> responseFlux = this.streamingChatModel.stream(prompt);
                responseFlux.doOnError(error -> {
                    this.observabilityHandler.recordError(context, error);
                    SpringAIErrorMapper.MappedError mappedError = SpringAIErrorMapper.mapError(error);
                    emitter.onError(new RuntimeException(mappedError.getNormalizedMessage(), error));
                }).subscribe(chatResponse -> {
                    try {
                        this.relayReasoning(chatResponse);
                        LlmResponse llmResponse = this.messageConverter.toLlmResponse(chatResponse, true);
                        emitter.onNext(llmResponse);
                    }
                    catch (Exception e) {
                        this.observabilityHandler.recordError(context, e);
                        SpringAIErrorMapper.MappedError mappedError = SpringAIErrorMapper.mapError(e);
                        emitter.onError(new RuntimeException(mappedError.getNormalizedMessage(), e));
                    }
                }, error -> {
                    this.observabilityHandler.recordError(context, error);
                    SpringAIErrorMapper.MappedError mappedError = SpringAIErrorMapper.mapError(error);
                    emitter.onError(new RuntimeException(mappedError.getNormalizedMessage(), error));
                }, () -> {
                    this.observabilityHandler.recordSuccess(context, 0, 0, 0);
                    emitter.onComplete();
                });
            }
            catch (Exception e) {
                this.observabilityHandler.recordError(context, e);
                SpringAIErrorMapper.MappedError mappedError = SpringAIErrorMapper.mapError(e);
                emitter.onError(new RuntimeException(mappedError.getNormalizedMessage(), e));
            }
        }, BackpressureStrategy.BUFFER)
        // 【本地扩展 / 260726】把 ADK 下游处理（含工具同步执行）调离 reactor-netty 事件循环：
        // 不加这行时，LLM 流式 chunk 在 reactor-http-nio-* 线程上直接驱动 FunctionTool——
        // 确认门/SSH exec 等阻塞型工具会把共享事件循环挂住，所有会话的 LLM 网络收发
        // 一并瘫痪（jstack 实锤：reactor-http-nio-2 停在 ConfirmGate.requestConfirm 120s）。
        // observeOn(io) 后阻塞只消耗一根可扩容的 io 线程，事件循环安全。
        .observeOn(Schedulers.io());
    }

    public BaseLlmConnection connect(LlmRequest llmRequest) {
        throw new UnsupportedOperationException("Live connection is not supported for Spring AI models.");
    }

    /**
     * 【本地扩展 / 260723】thinking 开关注入：经 OpenAiChatOptions.extraBody（@JsonAnyGetter
     * 展平到请求体顶层），流式与非流式统一生效。取代原 AiApiNode 的 RestClient 拦截器方案——
     * 流式请求走 WebClient（OpenAiApi.chatCompletionStream），RestClient 拦截器对其从未生效。
     *
     * <p>GLM 默认开思考需 disabled 显式关闭；DeepSeek 官方默认 enabled、部分兼容端点默认关——
     * 「不注入靠默认」在不同端点语义漂移，故对已知支持 thinking 字段的模型一律显式注入。
     * gpt 等其它模型跳过（未知顶层字段会 400，模型可插拔兼容）。
     */
    private Prompt injectThinkingOptions(Prompt prompt) {
        try {
            String model = this.resolveConfiguredModel();
            String lower = model == null ? "" : model.toLowerCase();
            if (!lower.contains("glm") && !lower.contains("deepseek")) {
                return prompt;
            }
            ChatOptions src = prompt.getOptions();
            OpenAiChatOptions.Builder builder = OpenAiChatOptions.builder();
            if (src != null) {
                if (src.getModel() != null) builder.model(src.getModel());
                if (src.getTemperature() != null) builder.temperature(src.getTemperature());
                if (src.getMaxTokens() != null) builder.maxTokens(src.getMaxTokens());
                if (src.getTopP() != null) builder.topP(src.getTopP());
                if (src.getStopSequences() != null) builder.stop(src.getStopSequences());
                if (src.getFrequencyPenalty() != null) builder.frequencyPenalty(src.getFrequencyPenalty());
                if (src.getPresencePenalty() != null) builder.presencePenalty(src.getPresencePenalty());
            }
            OpenAiChatOptions target = builder.build();
            if (src instanceof ToolCallingChatOptions toolOptions) {
                target.setToolCallbacks(toolOptions.getToolCallbacks());
                target.setInternalToolExecutionEnabled(toolOptions.getInternalToolExecutionEnabled());
            }
            target.setExtraBody(Map.of("thinking",
                    Map.of("type", ThinkingContext.isEnabled() ? "enabled" : "disabled")));
            return new Prompt(prompt.getInstructions(), target);
        } catch (Exception e) {
            // 注入失败退回原 prompt：思考开关失灵但对话不受影响
            return prompt;
        }
    }

    /** 真实模型名在 ChatModel 的默认 options 里（BaseLlm.model() 只是类名派生的 "openai"） */
    private String resolveConfiguredModel() {
        ChatModel m = this.chatModel != null ? this.chatModel
                : this.streamingChatModel instanceof ChatModel cm ? cm : null;
        if (m != null && m.getDefaultOptions() != null) {
            return m.getDefaultOptions().getModel();
        }
        return null;
    }

    /**
     * 【本地扩展 / 260723 决议 8】深度思考片段旁路：流式 chunk 的 reasoning_content 由
     * OpenAiChatModel.buildGeneration 塞进 AssistantMessage properties（key=reasoningContent，
     * 每 chunk 为增量），刻意不转进 ADK Content（session 拼接会污染上下文），
     * 经 {@link ReasoningRelay} 直达 AiCallNode 的 NDJSON 通道。
     * GLM 与 DeepSeek 的该字段同名同层级，天然双兼容。
     */
    private void relayReasoning(ChatResponse chatResponse) {
        try {
            if (chatResponse == null || chatResponse.getResult() == null) {
                return;
            }
            Object rc = chatResponse.getResult().getOutput().getMetadata().get("reasoningContent");
            if (rc instanceof String s) {
                ReasoningRelay.emit(s);
            }
        } catch (Exception ignore) {
            // 旁路失败不影响正文流
        }
    }

    private static String extractModelName(Object model) {
        String className = model.getClass().getSimpleName();
        return className.toLowerCase().replace("chatmodel", "").replace("model", "");
    }

    private SpringAIProperties.Observability createDefaultObservabilityConfig() {
        SpringAIProperties.Observability config = new SpringAIProperties.Observability();
        config.setEnabled(true);
        config.setMetricsEnabled(true);
        config.setIncludeContent(false);
        return config;
    }

    private int extractTokenCount(ChatResponse chatResponse) {
        try {
            if (chatResponse.getMetadata() != null && chatResponse.getMetadata().getUsage() != null) {
                return chatResponse.getMetadata().getUsage().getTotalTokens();
            }
        }
        catch (Exception exception) {
            // empty catch block
        }
        return 0;
    }

    private int extractInputTokenCount(ChatResponse chatResponse) {
        try {
            if (chatResponse.getMetadata() != null && chatResponse.getMetadata().getUsage() != null) {
                return chatResponse.getMetadata().getUsage().getPromptTokens();
            }
        }
        catch (Exception exception) {
            // empty catch block
        }
        return 0;
    }

    private int extractOutputTokenCount(ChatResponse chatResponse) {
        try {
            if (chatResponse.getMetadata() != null && chatResponse.getMetadata().getUsage() != null) {
                return chatResponse.getMetadata().getUsage().getCompletionTokens();
            }
        }
        catch (Exception exception) {
            // empty catch block
        }
        return 0;
    }

    private String extractTextFromResponse(LlmResponse response) {
        if (response.content().isPresent() && ((Content)response.content().get()).parts().isPresent()) {
            return ((List<Part>)((Content)response.content().get()).parts().get()).stream()
                    .map(part -> part.text().orElse(""))
                    .filter(text -> text != null && !text.isEmpty())
                    .findFirst().orElse("");
        }
        return "";
    }
}

