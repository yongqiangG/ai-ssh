/*
 * Decompiled with CFR 0.152.
 */
package com.johnny.domain.agent.bridge.springai.error;

import java.net.SocketTimeoutException;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class SpringAIErrorMapper {
    private static final Logger logger = LoggerFactory.getLogger(SpringAIErrorMapper.class);

    public static MappedError mapError(Throwable exception) {
        if (exception == null) {
            return new MappedError(ErrorCategory.UNKNOWN_ERROR, RetryStrategy.NO_RETRY, "Unknown error");
        }
        String message = exception.getMessage();
        String className = exception.getClass().getSimpleName();
        logger.debug("Mapping Spring AI error: {} - {}", (Object)className, (Object)message);
        if (exception instanceof TimeoutException || exception instanceof SocketTimeoutException) {
            return new MappedError(ErrorCategory.TIMEOUT_ERROR, RetryStrategy.EXPONENTIAL_BACKOFF, "Request timed out: " + message);
        }
        if (message != null) {
            String lowerMessage = message.toLowerCase();
            if (lowerMessage.contains("unauthorized") || lowerMessage.contains("authentication") || lowerMessage.contains("api key") || lowerMessage.contains("invalid key") || lowerMessage.contains("401")) {
                return new MappedError(ErrorCategory.AUTH_ERROR, RetryStrategy.NO_RETRY, "Authentication failed: " + message);
            }
            if (lowerMessage.contains("rate limit") || lowerMessage.contains("quota exceeded") || lowerMessage.contains("too many requests") || lowerMessage.contains("429")) {
                return new MappedError(ErrorCategory.RATE_LIMITED, RetryStrategy.EXPONENTIAL_BACKOFF, "Rate limited: " + message);
            }
            if (lowerMessage.contains("bad request") || lowerMessage.contains("invalid") || lowerMessage.contains("400") || lowerMessage.contains("404") || lowerMessage.contains("model not found") || lowerMessage.contains("unsupported")) {
                return new MappedError(ErrorCategory.CLIENT_ERROR, RetryStrategy.NO_RETRY, "Client error: " + message);
            }
            if (lowerMessage.contains("internal server error") || lowerMessage.contains("service unavailable") || lowerMessage.contains("502") || lowerMessage.contains("503") || lowerMessage.contains("500")) {
                return new MappedError(ErrorCategory.SERVER_ERROR, RetryStrategy.EXPONENTIAL_BACKOFF, "Server error: " + message);
            }
            if (lowerMessage.contains("connection") || lowerMessage.contains("network") || lowerMessage.contains("host") || lowerMessage.contains("dns")) {
                return new MappedError(ErrorCategory.NETWORK_ERROR, RetryStrategy.FIXED_DELAY, "Network error: " + message);
            }
            if (lowerMessage.contains("model") && (lowerMessage.contains("not found") || lowerMessage.contains("unavailable") || lowerMessage.contains("deprecated"))) {
                return new MappedError(ErrorCategory.MODEL_ERROR, RetryStrategy.NO_RETRY, "Model error: " + message);
            }
        }
        if (className.toLowerCase().contains("timeout")) {
            return new MappedError(ErrorCategory.TIMEOUT_ERROR, RetryStrategy.EXPONENTIAL_BACKOFF, "Timeout error: " + message);
        }
        if (className.toLowerCase().contains("network") || className.toLowerCase().contains("connection")) {
            return new MappedError(ErrorCategory.NETWORK_ERROR, RetryStrategy.FIXED_DELAY, "Network error: " + message);
        }
        return new MappedError(ErrorCategory.UNKNOWN_ERROR, RetryStrategy.NO_RETRY, "Unknown error: " + className + " - " + message);
    }

    public static boolean isRetryable(ErrorCategory category) {
        switch (category) {
            case RATE_LIMITED: 
            case NETWORK_ERROR: 
            case TIMEOUT_ERROR: 
            case SERVER_ERROR: {
                return true;
            }
        }
        return false;
    }

    public static long getRetryDelay(RetryStrategy strategy, int attempt) {
        switch (strategy) {
            case IMMEDIATE_RETRY: {
                return 0L;
            }
            case FIXED_DELAY: {
                return 1000L;
            }
            case EXPONENTIAL_BACKOFF: {
                return Math.min(1000L * (1L << attempt), 30000L);
            }
        }
        return -1L;
    }

    public static class MappedError {
        private final ErrorCategory category;
        private final RetryStrategy retryStrategy;
        private final String normalizedMessage;

        public MappedError(ErrorCategory category, RetryStrategy retryStrategy, String normalizedMessage) {
            this.category = category;
            this.retryStrategy = retryStrategy;
            this.normalizedMessage = normalizedMessage;
        }

        public ErrorCategory getCategory() {
            return this.category;
        }

        public RetryStrategy getRetryStrategy() {
            return this.retryStrategy;
        }

        public String getNormalizedMessage() {
            return this.normalizedMessage;
        }

        public boolean isRetryable() {
            return SpringAIErrorMapper.isRetryable(this.category);
        }

        public long getRetryDelay(int attempt) {
            return SpringAIErrorMapper.getRetryDelay(this.retryStrategy, attempt);
        }

        public String toString() {
            return "MappedError{category=" + this.category + ", retryStrategy=" + this.retryStrategy + ", message='" + this.normalizedMessage + "'}";
        }
    }

    public static enum ErrorCategory {
        AUTH_ERROR,
        RATE_LIMITED,
        NETWORK_ERROR,
        CLIENT_ERROR,
        SERVER_ERROR,
        TIMEOUT_ERROR,
        MODEL_ERROR,
        UNKNOWN_ERROR;

    }

    public static enum RetryStrategy {
        NO_RETRY,
        EXPONENTIAL_BACKOFF,
        FIXED_DELAY,
        IMMEDIATE_RETRY;

    }
}

