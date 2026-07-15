package com.johnny.domain.agent.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 本地默认 LLM 配置。single 模式下由用户维护，企业模式后续可替换为统一网关配置。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmConfigEntity {

    public static final String DEFAULT_CONFIG_ID = "default";

    private String configId;
    private String providerName;
    private String baseUrl;
    private String apiKey;
    private String model;
    private String completionsPath;

    public boolean hasApiKey() {
        return apiKey != null && !apiKey.isBlank();
    }
}
