package com.johnny.api.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmConfigDTO {

    private String providerName;
    private String baseUrl;
    private String model;
    private String completionsPath;
    private Boolean apiKeyConfigured;
}
