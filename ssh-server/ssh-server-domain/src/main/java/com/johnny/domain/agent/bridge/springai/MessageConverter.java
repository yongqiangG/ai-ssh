/*
 * Decompiled with CFR 0.152.
 */
package com.johnny.domain.agent.bridge.springai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.adk.models.LlmRequest;
import com.google.adk.models.LlmResponse;
import com.johnny.domain.agent.bridge.springai.ConfigMapper;
import com.johnny.domain.agent.bridge.springai.MessageConversionException;
import com.johnny.domain.agent.bridge.springai.ToolConverter;
import com.google.genai.types.Blob;
import com.google.genai.types.Content;
import com.google.genai.types.FileData;
import com.google.genai.types.FunctionCall;
import com.google.genai.types.FunctionResponse;
import com.google.genai.types.Part;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.content.Media;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.util.CollectionUtils;
import org.springframework.util.MimeType;

public class MessageConverter {
    private static final TypeReference<Map<String, Object>> MAP_TYPE_REFERENCE = new TypeReference<Map<String, Object>>(){};
    private final ObjectMapper objectMapper;
    private final ToolConverter toolConverter;
    private final ConfigMapper configMapper;

    public MessageConverter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.toolConverter = new ToolConverter();
        this.configMapper = new ConfigMapper();
    }

    public Prompt toLlmPrompt(LlmRequest llmRequest) {
        List<ToolCallback> toolCallbacks;
        List<Message> messages = new ArrayList<>();
        ArrayList<String> allSystemMessages = new ArrayList<String>();
        allSystemMessages.addAll((Collection<String>)llmRequest.getSystemInstructions());
        ArrayList<Message> nonSystemMessages = new ArrayList<Message>();
        for (Content content : llmRequest.contents()) {
            String role = content.role().orElse("user").toLowerCase();
            if ("system".equals(role)) {
                StringBuilder systemText = new StringBuilder();
                for (Part part : content.parts().orElse(List.of())) {
                    if (!part.text().isPresent()) continue;
                    systemText.append((String)part.text().get());
                }
                if (systemText.length() <= 0) continue;
                allSystemMessages.add(systemText.toString());
                continue;
            }
            nonSystemMessages.addAll(this.toSpringAiMessages(content));
        }
        if (!allSystemMessages.isEmpty()) {
            String combinedSystemMessage = String.join((CharSequence)"\n\n", allSystemMessages);
            messages.add(new SystemMessage(combinedSystemMessage));
        }
        messages.addAll(nonSystemMessages);
        ChatOptions chatOptions = this.configMapper.toSpringAiChatOptions(llmRequest.config());
        if (llmRequest.tools() != null && !llmRequest.tools().isEmpty() && !(toolCallbacks = this.toolConverter.convertToSpringAiTools(llmRequest.tools())).isEmpty()) {
            ToolCallingChatOptions.Builder optionsBuilder = ToolCallingChatOptions.builder();
            optionsBuilder.toolCallbacks(toolCallbacks);
            // 【改动点 1 / vendored from google-adk-spring-ai 1.2.0】关闭 Spring AI 内部工具执行（Q7 方案 B）：
            // 把 toolCall 原样返给 ADK，由 ADK 原生 flow 执行 BaseTool、触发插件回调、再循环调模型。
            // 官方版本缺这一行，导致 Spring AI 自己执行工具、ADK 事件流 functionCalls() 为空（stateDelta 坑）。
            optionsBuilder.internalToolExecutionEnabled(false);
            if (chatOptions != null) {
                if (chatOptions.getTemperature() != null) {
                    optionsBuilder.temperature(chatOptions.getTemperature());
                }
                if (chatOptions.getMaxTokens() != null) {
                    optionsBuilder.maxTokens(chatOptions.getMaxTokens());
                }
                if (chatOptions.getTopP() != null) {
                    optionsBuilder.topP(chatOptions.getTopP());
                }
                if (chatOptions.getTopK() != null) {
                    optionsBuilder.topK(chatOptions.getTopK());
                }
                if (chatOptions.getStopSequences() != null) {
                    optionsBuilder.stopSequences(chatOptions.getStopSequences());
                }
                if (chatOptions.getModel() != null) {
                    optionsBuilder.model(chatOptions.getModel());
                }
                if (chatOptions.getFrequencyPenalty() != null) {
                    optionsBuilder.frequencyPenalty(chatOptions.getFrequencyPenalty());
                }
                if (chatOptions.getPresencePenalty() != null) {
                    optionsBuilder.presencePenalty(chatOptions.getPresencePenalty());
                }
            }
            chatOptions = optionsBuilder.build();
        }
        return new Prompt(messages, chatOptions);
    }

    public Map<String, ToolConverter.ToolMetadata> getToolRegistry(LlmRequest llmRequest) {
        return this.toolConverter.createToolRegistry(llmRequest.tools());
    }

    private List<Message> toSpringAiMessages(Content content) {
        String role;
        return switch (role = content.role().orElse("user").toLowerCase()) {
            case "user" -> this.handleUserContent(content);
            case "model", "assistant" -> List.of(this.handleAssistantContent(content));
            case "system" -> List.of(this.handleSystemContent(content));
            default -> throw new IllegalStateException("Unexpected role: " + role);
        };
    }

    private List<Message> handleUserContent(Content content) {
        StringBuilder textBuilder = new StringBuilder();
        List<ToolResponseMessage> toolResponseMessages = new ArrayList<>();
        ArrayList<Media> mediaList = new ArrayList<Media>();
        for (Part part : content.parts().orElse(List.of())) {
            FileData fileData;
            MimeType mimeType;
            if (part.text().isPresent()) {
                textBuilder.append((String)part.text().get());
                continue;
            }
            if (part.functionResponse().isPresent()) {
                // 【改动点 2 / vendored from google-adk-spring-ai 1.2.0】ADK functionResponse → Spring AI
                // ToolResponseMessage（role=tool）。官方在此处直接 continue 跳过——严格 OpenAI/GLM 端点
                // 要求 assistant.tool_calls 后必须跟 role=tool 消息，否则 400。
                // fr.id() 来自 ADK Functions.java:299（= 同 round functionCall.id()），与 tool_calls[].id 关联一致。
                FunctionResponse fr = (FunctionResponse) part.functionResponse().get();
                String respJson = this.toJson(fr.response().orElse(Map.of()));
                toolResponseMessages.add(
                        ToolResponseMessage.builder()
                                .responses(List.of(new ToolResponseMessage.ToolResponse(
                                        fr.id().orElse(""),
                                        fr.name().orElse(""),
                                        respJson)))
                                .build());
                continue;
            }
            if (part.inlineData().isPresent()) {
                Blob blob = (Blob)part.inlineData().get();
                if (!blob.mimeType().isPresent() || !blob.data().isPresent()) continue;
                try {
                    mimeType = MimeType.valueOf((String)((String)blob.mimeType().get()));
                    ByteArrayResource resource = new ByteArrayResource((byte[])blob.data().get());
                    mediaList.add(new Media(mimeType, (Resource)resource));
                }
                catch (Exception e) {
                    System.err.println("Warning: Failed to process media part: " + e.getMessage());
                }
                continue;
            }
            if (!part.fileData().isPresent() || !(fileData = (FileData)part.fileData().get()).mimeType().isPresent() || !fileData.fileUri().isPresent()) continue;
            try {
                mimeType = MimeType.valueOf((String)((String)fileData.mimeType().get()));
                URI uri = URI.create((String)fileData.fileUri().get());
                mediaList.add(new Media(mimeType, uri));
            }
            catch (Exception e) {
                System.err.println("Warning: Failed to process media part: " + e.getMessage());
            }
        }
        ArrayList<Message> messages = new ArrayList<Message>();
        // 仅当有文本或媒体时才添加 UserMessage。ADK 把 functionResponse 包在 role=user 的 Content 里，
        // 若此处仍无条件 add UserMessage("")，会在 assistant(tool_calls) 与 tool 结果之间插入空 user 消息，
        // 打断合法序列，GLM 报「未正常接收到prompt参数」(code 1213)。
        if (textBuilder.length() > 0 || !mediaList.isEmpty()) {
            messages.add(UserMessage.builder().text(textBuilder.toString()).media(mediaList).build());
        }
        messages.addAll(toolResponseMessages);
        return messages;
    }

    private AssistantMessage handleAssistantContent(Content content) {
        StringBuilder textBuilder = new StringBuilder();
        ArrayList<AssistantMessage.ToolCall> toolCalls = new ArrayList<AssistantMessage.ToolCall>();
        for (Part part : content.parts().orElse(List.of())) {
            if (part.text().isPresent()) {
                textBuilder.append((String)part.text().get());
                continue;
            }
            if (!part.functionCall().isPresent()) continue;
            FunctionCall functionCall = (FunctionCall)part.functionCall().get();
            toolCalls.add(new AssistantMessage.ToolCall((String)functionCall.id().orElseThrow(() -> new IllegalStateException("Function call ID is missing")), "function", (String)functionCall.name().orElseThrow(() -> new IllegalStateException("Function call name is missing")), this.toJson(functionCall.args().orElse(Map.of()))));
        }
        String text = textBuilder.toString();
        if (toolCalls.isEmpty()) {
            return new AssistantMessage(text);
        }
        return AssistantMessage.builder().content(text).toolCalls(toolCalls).build();
    }

    private SystemMessage handleSystemContent(Content content) {
        StringBuilder textBuilder = new StringBuilder();
        for (Part part : content.parts().orElse(List.of())) {
            if (!part.text().isPresent()) continue;
            textBuilder.append((String)part.text().get());
        }
        return new SystemMessage(textBuilder.toString());
    }

    public LlmResponse toLlmResponse(ChatResponse chatResponse) {
        return this.toLlmResponse(chatResponse, false);
    }

    public LlmResponse toLlmResponse(ChatResponse chatResponse, boolean isStreaming) {
        if (chatResponse == null || CollectionUtils.isEmpty((Collection)chatResponse.getResults())) {
            return LlmResponse.builder().build();
        }
        Generation generation = chatResponse.getResult();
        AssistantMessage assistantMessage = generation.getOutput();
        Content content = this.convertAssistantMessageToContent(assistantMessage);
        boolean isPartial = isStreaming && this.isPartialResponse(chatResponse, assistantMessage);
        boolean isTurnComplete = !isStreaming || this.isTurnCompleteResponse(chatResponse);
        return LlmResponse.builder().content(content).partial(Boolean.valueOf(isPartial)).turnComplete(Boolean.valueOf(isTurnComplete)).build();
    }

    /**
     * 【本地修复 / 260723】流式 chunk 的 partial 判定改用 finishReason 协议语义。
     *
     * <p>原实现按英文标点启发式（文本不以 {@code .!?\n} 结尾即 partial）——OpenAI 兼容端点
     * 常把 finish_reason 附在最后一个有内容的 chunk 上，中文回复以「。」「**」等结尾时该
     * 结束帧被误判 partial=true；ADK 主循环以「最后事件 partial=false」为终止条件
     * （Event.finalResponse），于是判定本轮无最终回复而重调 LLM，直至 maxLlmCalls=10 熔断
     * ——表现为回复正文里同一答案的多个变体连排、token 消耗数倍放大。
     *
     * <p>现语义：带 finishReason 的 chunk 一律非 partial（本轮结束帧）；无 finishReason 的
     * 中间 chunk 有文本即 partial（流式预览）。
     */
    private boolean isPartialResponse(ChatResponse response, AssistantMessage message) {
        Generation generation = response.getResult();
        String finishReason = generation != null && generation.getMetadata() != null
                ? generation.getMetadata().getFinishReason()
                : null;
        if (finishReason != null && !finishReason.isBlank()) {
            return false;
        }
        String text = message.getText();
        return text != null && !text.isEmpty() && message.getToolCalls().isEmpty();
    }

    private boolean isTurnCompleteResponse(ChatResponse response) {
        Generation generation = response.getResult();
        if (generation != null && generation.getMetadata() != null) {
            String finishReason = generation.getMetadata().getFinishReason();
            return finishReason == null || "stop".equals(finishReason) || "tool_calls".equals(finishReason);
        }
        return true;
    }

    private Content convertAssistantMessageToContent(AssistantMessage assistantMessage) {
        ArrayList<Part> parts = new ArrayList<Part>();
        if (assistantMessage.getText() != null && !assistantMessage.getText().isEmpty()) {
            parts.add(Part.fromText((String)assistantMessage.getText()));
        }
        for (AssistantMessage.ToolCall toolCall : assistantMessage.getToolCalls()) {
            if (!"function".equals(toolCall.type())) continue;
            try {
                Map args = (Map)this.objectMapper.readValue(toolCall.arguments(), MAP_TYPE_REFERENCE);
                FunctionCall functionCall = FunctionCall.builder().id(toolCall.id()).name(toolCall.name()).args(args).build();
                parts.add(Part.builder().functionCall(functionCall).build());
            }
            catch (JsonProcessingException e) {
                throw MessageConversionException.jsonParsingFailed("tool call arguments", e);
            }
        }
        return Content.builder().role("model").parts(parts).build();
    }

    private String toJson(Object object) {
        try {
            return this.objectMapper.writeValueAsString(object);
        }
        catch (JsonProcessingException e) {
            throw MessageConversionException.jsonParsingFailed("object serialization", e);
        }
    }
}

