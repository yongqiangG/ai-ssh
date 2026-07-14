/*
 * Decompiled with CFR 0.152.
 */
package com.johnny.domain.agent.bridge.springai.properties;

import jakarta.annotation.Nullable;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties(prefix="adk.spring-ai")
@Validated
public class SpringAIProperties {
    @Nullable
    private String model;
    @DecimalMin(value="0.0", message="Temperature must be at least 0.0")
    @DecimalMax(value="2.0", message="Temperature must be at most 2.0")
    private @DecimalMin(value="0.0", message="Temperature must be at least 0.0") @DecimalMax(value="2.0", message="Temperature must be at most 2.0") Double temperature = 0.7;
    @Min(value=1L, message="Max tokens must be at least 1")
    private @Min(value=1L, message="Max tokens must be at least 1") Integer maxTokens = 2048;
    @DecimalMin(value="0.0", message="Top-p must be at least 0.0")
    @DecimalMax(value="1.0", message="Top-p must be at most 1.0")
    private @DecimalMin(value="0.0", message="Top-p must be at least 0.0") @DecimalMax(value="1.0", message="Top-p must be at most 1.0") Double topP = 0.9;
    @Min(value=1L, message="Top-k must be at least 1")
    private @Min(value=1L, message="Top-k must be at least 1") Integer topK;
    private Validation validation = new Validation();
    private Observability observability = new Observability();

    public String getModel() {
        return this.model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public Double getTemperature() {
        return this.temperature;
    }

    public void setTemperature(Double temperature) {
        this.temperature = temperature;
    }

    public Integer getMaxTokens() {
        return this.maxTokens;
    }

    public void setMaxTokens(Integer maxTokens) {
        this.maxTokens = maxTokens;
    }

    public Double getTopP() {
        return this.topP;
    }

    public void setTopP(Double topP) {
        this.topP = topP;
    }

    public Integer getTopK() {
        return this.topK;
    }

    public void setTopK(Integer topK) {
        this.topK = topK;
    }

    public Validation getValidation() {
        return this.validation;
    }

    public void setValidation(Validation validation) {
        this.validation = validation;
    }

    public Observability getObservability() {
        return this.observability;
    }

    public void setObservability(Observability observability) {
        this.observability = observability;
    }

    public static class Validation {
        private boolean enabled = true;
        private boolean failFast = true;

        public boolean isEnabled() {
            return this.enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public boolean isFailFast() {
            return this.failFast;
        }

        public void setFailFast(boolean failFast) {
            this.failFast = failFast;
        }
    }

    public static class Observability {
        private boolean enabled = true;
        private boolean includeContent = false;
        private boolean metricsEnabled = true;

        public boolean isEnabled() {
            return this.enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public boolean isIncludeContent() {
            return this.includeContent;
        }

        public void setIncludeContent(boolean includeContent) {
            this.includeContent = includeContent;
        }

        public boolean isMetricsEnabled() {
            return this.metricsEnabled;
        }

        public void setMetricsEnabled(boolean metricsEnabled) {
            this.metricsEnabled = metricsEnabled;
        }
    }
}

