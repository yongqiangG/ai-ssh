package com.johnny.infrastructure.dao.po;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmConfigPO {

    private Long id;
    private String configId;
    private String providerName;
    private String baseUrl;
    private String apiKey;
    private String model;
    private String completionsPath;
    private Date updatedAt;
}
