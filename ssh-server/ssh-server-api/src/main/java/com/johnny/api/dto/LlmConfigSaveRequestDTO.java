package com.johnny.api.dto;

import lombok.Data;

@Data
public class LlmConfigSaveRequestDTO {

    private String providerName;
    private String baseUrl;
    private String apiKey;
    private String model;
    private String completionsPath;
    private Boolean keepExistingApiKey;
}
