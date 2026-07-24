package com.johnny.domain.agent.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmConfigSaveResult {

    private LlmConfigEntity config;
    private boolean configChanged;
    private boolean runnerReloadRequired;

    public boolean configChanged() {
        return configChanged;
    }

    public boolean runnerReloadRequired() {
        return runnerReloadRequired;
    }
}
