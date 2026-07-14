/*
 * Decompiled with CFR 0.152.
 */
package com.johnny.domain.agent.bridge.springai.observability;

import com.johnny.domain.agent.bridge.springai.properties.SpringAIProperties;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class SpringAIObservabilityHandler {
    private static final Logger logger = LoggerFactory.getLogger(SpringAIObservabilityHandler.class);
    private final SpringAIProperties.Observability config;
    private final MeterRegistry meterRegistry;

    public SpringAIObservabilityHandler(SpringAIProperties.Observability config) {
        this(config, (MeterRegistry)new SimpleMeterRegistry());
    }

    public SpringAIObservabilityHandler(SpringAIProperties.Observability config, MeterRegistry meterRegistry) {
        this.config = config;
        this.meterRegistry = meterRegistry;
    }

    public RequestContext startRequest(String modelName, String requestType) {
        if (!this.config.isEnabled()) {
            return new RequestContext(modelName, requestType, Instant.now(), false, null);
        }
        Timer.Sample timerSample = this.config.isMetricsEnabled() ? Timer.start((MeterRegistry)this.meterRegistry) : null;
        RequestContext context = new RequestContext(modelName, requestType, Instant.now(), true, timerSample);
        if (this.config.isMetricsEnabled()) {
            Counter.builder((String)"spring.ai.requests.total").tag("model", modelName).tag("type", requestType).description("Total number of Spring AI requests").register(this.meterRegistry).increment();
            logger.debug("Started {} request for model: {}", (Object)requestType, (Object)modelName);
        }
        return context;
    }

    public void recordSuccess(RequestContext context, int tokenCount, int inputTokens, int outputTokens) {
        if (!context.isObservable()) {
            return;
        }
        Duration duration = Duration.between(context.getStartTime(), Instant.now());
        if (this.config.isMetricsEnabled()) {
            if (context.getTimerSample() != null) {
                context.getTimerSample().stop(Timer.builder((String)"spring.ai.request.duration").tag("model", context.getModelName()).tag("type", context.getRequestType()).tag("outcome", "success").description("Duration of Spring AI requests").register(this.meterRegistry));
            }
            Counter.builder((String)"spring.ai.requests.success").tag("model", context.getModelName()).tag("type", context.getRequestType()).description("Number of successful Spring AI requests").register(this.meterRegistry).increment();
            Gauge.builder((String)"spring.ai.tokens.total", () -> tokenCount).tag("model", context.getModelName()).description("Total tokens processed").register(this.meterRegistry);
            Gauge.builder((String)"spring.ai.tokens.input", () -> inputTokens).tag("model", context.getModelName()).description("Input tokens processed").register(this.meterRegistry);
            Gauge.builder((String)"spring.ai.tokens.output", () -> outputTokens).tag("model", context.getModelName()).description("Output tokens generated").register(this.meterRegistry);
        }
        logger.info("Request completed successfully: model={}, type={}, duration={}ms, tokens={}", new Object[]{context.getModelName(), context.getRequestType(), duration.toMillis(), tokenCount});
    }

    public void recordError(RequestContext context, Throwable error) {
        if (!context.isObservable()) {
            return;
        }
        Duration duration = Duration.between(context.getStartTime(), Instant.now());
        if (this.config.isMetricsEnabled()) {
            if (context.getTimerSample() != null) {
                context.getTimerSample().stop(Timer.builder((String)"spring.ai.request.duration").tag("model", context.getModelName()).tag("type", context.getRequestType()).tag("outcome", "error").description("Duration of Spring AI requests").register(this.meterRegistry));
            }
            Counter.builder((String)"spring.ai.requests.error").tag("model", context.getModelName()).tag("type", context.getRequestType()).description("Number of failed Spring AI requests").register(this.meterRegistry).increment();
            Counter.builder((String)"spring.ai.errors.by.type").tag("error.type", error.getClass().getSimpleName()).description("Number of errors by exception type").register(this.meterRegistry).increment();
        }
        logger.error("Request failed: model={}, type={}, duration={}ms, error={}", new Object[]{context.getModelName(), context.getRequestType(), duration.toMillis(), error.getMessage()});
    }

    public void logRequest(String content, String modelName) {
        if (this.config.isEnabled() && this.config.isIncludeContent()) {
            logger.debug("Request to {}: {}", (Object)modelName, (Object)this.truncateContent(content));
        }
    }

    public void logResponse(String content, String modelName) {
        if (this.config.isEnabled() && this.config.isIncludeContent()) {
            logger.debug("Response from {}: {}", (Object)modelName, (Object)this.truncateContent(content));
        }
    }

    public MeterRegistry getMeterRegistry() {
        return this.meterRegistry;
    }

    private String truncateContent(String content) {
        if (content == null) {
            return "null";
        }
        return content.length() > 500 ? content.substring(0, 500) + "..." : content;
    }

    public static class RequestContext {
        private final String modelName;
        private final String requestType;
        private final Instant startTime;
        private final boolean observable;
        private final Timer.Sample timerSample;

        public RequestContext(String modelName, String requestType, Instant startTime, boolean observable, Timer.Sample timerSample) {
            this.modelName = modelName;
            this.requestType = requestType;
            this.startTime = startTime;
            this.observable = observable;
            this.timerSample = timerSample;
        }

        public String getModelName() {
            return this.modelName;
        }

        public String getRequestType() {
            return this.requestType;
        }

        public Instant getStartTime() {
            return this.startTime;
        }

        public boolean isObservable() {
            return this.observable;
        }

        public Timer.Sample getTimerSample() {
            return this.timerSample;
        }
    }
}

