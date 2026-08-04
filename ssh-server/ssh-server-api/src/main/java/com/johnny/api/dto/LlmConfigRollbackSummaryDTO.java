package com.johnny.api.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** 不包含 API Key 的上一版 LLM 配置摘要。 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmConfigRollbackSummaryDTO {

    private String providerName;
    private String baseUrl;
    private String model;
    private String completionsPath;
    private Boolean apiKeyConfigured;
}
