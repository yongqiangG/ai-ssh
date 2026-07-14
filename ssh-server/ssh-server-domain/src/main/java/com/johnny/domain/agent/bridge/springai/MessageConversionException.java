/*
 * Decompiled with CFR 0.152.
 */
package com.johnny.domain.agent.bridge.springai;

public class MessageConversionException
extends RuntimeException {
    public MessageConversionException(String message) {
        super(message);
    }

    public MessageConversionException(String message, Throwable cause) {
        super(message, cause);
    }

    public MessageConversionException(Throwable cause) {
        super(cause);
    }

    public static MessageConversionException jsonParsingFailed(String context, Throwable cause) {
        return new MessageConversionException(String.format("Failed to parse JSON for %s", context), cause);
    }

    public static MessageConversionException invalidMessageStructure(String message) {
        return new MessageConversionException("Invalid message structure: " + message);
    }

    public static MessageConversionException unsupportedContentType(String contentType) {
        return new MessageConversionException("Unsupported content type: " + contentType);
    }
}

