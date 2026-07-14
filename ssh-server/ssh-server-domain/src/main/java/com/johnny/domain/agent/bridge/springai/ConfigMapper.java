/*
 * Decompiled with CFR 0.152.
 */
package com.johnny.domain.agent.bridge.springai;

import com.google.genai.types.GenerateContentConfig;
import java.util.Optional;
import org.springframework.ai.chat.prompt.ChatOptions;

public class ConfigMapper {
    public ChatOptions toSpringAiChatOptions(Optional<GenerateContentConfig> config) {
        if (config.isEmpty()) {
            return null;
        }
        GenerateContentConfig contentConfig = config.get();
        ChatOptions.Builder optionsBuilder = ChatOptions.builder();
        contentConfig.temperature().ifPresent(temp -> optionsBuilder.temperature(Double.valueOf(temp.doubleValue())));
        contentConfig.maxOutputTokens().ifPresent(arg_0 -> ((ChatOptions.Builder)optionsBuilder).maxTokens(arg_0));
        contentConfig.topP().ifPresent(topP -> optionsBuilder.topP(Double.valueOf(topP.doubleValue())));
        contentConfig.topK().ifPresent(topK -> optionsBuilder.topK(Integer.valueOf(topK.intValue())));
        contentConfig.stopSequences().filter(sequences -> !sequences.isEmpty()).ifPresent(arg_0 -> ((ChatOptions.Builder)optionsBuilder).stopSequences(arg_0));
        contentConfig.presencePenalty().ifPresent(penalty -> {});
        contentConfig.frequencyPenalty().ifPresent(penalty -> {});
        return optionsBuilder.build();
    }

    public ChatOptions createDefaultChatOptions() {
        return ChatOptions.builder().temperature(Double.valueOf(0.7)).maxTokens(Integer.valueOf(1000)).build();
    }

    public boolean isConfigurationValid(Optional<GenerateContentConfig> config) {
        float topK;
        float topP;
        float temp;
        if (config.isEmpty()) {
            return true;
        }
        GenerateContentConfig contentConfig = config.get();
        if (contentConfig.responseSchema().isPresent()) {
            return false;
        }
        if (contentConfig.responseMimeType().isPresent()) {
            return false;
        }
        if (contentConfig.temperature().isPresent() && ((temp = ((Float)contentConfig.temperature().get()).floatValue()) < 0.0f || temp > 2.0f)) {
            return false;
        }
        if (contentConfig.topP().isPresent() && ((topP = ((Float)contentConfig.topP().get()).floatValue()) < 0.0f || topP > 1.0f)) {
            return false;
        }
        return !contentConfig.topK().isPresent() || !((topK = ((Float)contentConfig.topK().get()).floatValue()) < 1.0f) && !(topK > 64.0f);
    }
}

