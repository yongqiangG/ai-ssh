package com.johnny.domain.react.node;

/**
 * LLM 调用异常 → 用户可理解的中文提示 + 机器码。
 *
 * 背景：vendored SpringAIErrorMapper 已做分类但输出英文技术串（且 EOF 类漏进
 * UNKNOWN），直达前端体验极差。本类不信任其前缀，自己遍历 cause 链按异常
 * 类型/关键词分类。原始异常串只进日志，人话只给指引动作（重试 / 查设置）。
 * 前端按 code 决定是否展示「重试」按钮（连接断/超时/限流/5xx/未知可重试）。
 */
final class LlmErrorHumanizer {

    record Result(String code, String message) {
    }

    private LlmErrorHumanizer() {
    }

    static Result humanize(Throwable exception) {
        String haystack = collectText(exception);

        if (containsAny(haystack, "eof reached", "connection reset", "connection refused",
                "webclientrequestexception", "prematureclose", "broken pipe")) {
            return new Result("LLM_CONNECTION_LOST",
                    "与模型服务的连接中断，常见于网络波动或中转服务不稳定，请重试");
        }
        if (containsAny(haystack, "401", "unauthorized", "authentication", "api key", "invalid key")) {
            return new Result("LLM_AUTH_FAILED",
                    "模型认证失败，请到「模型设置」检查 API Key 是否有效");
        }
        if (containsAny(haystack, "429", "rate limit", "too many requests", "quota")) {
            return new Result("LLM_RATE_LIMITED",
                    "模型服务限流，稍等片刻再试");
        }
        if (containsAny(haystack, "timeout", "timed out")) {
            return new Result("LLM_TIMEOUT",
                    "模型响应超时，网络或服务繁忙，请重试");
        }
        if (containsAny(haystack, "404", "model not found", "400", "bad request", "unsupported")) {
            return new Result("LLM_BAD_CONFIG",
                    "请求被模型服务拒绝，请到「模型设置」检查模型名称与接口路径");
        }
        if (containsAny(haystack, "500", "502", "503", "internal server error", "service unavailable")) {
            return new Result("LLM_SERVER_ERROR",
                    "模型服务暂时不可用，请稍后重试");
        }
        if (containsAny(haystack, "unknownhost", "dns", "no route to host", "network")) {
            return new Result("LLM_CONNECTION_LOST",
                    "无法连接模型服务，请检查网络或「模型设置」中的 Base URL");
        }
        return new Result("LLM_UNKNOWN",
                "AI 调用失败，请重试；若持续失败请检查「模型设置」");
    }

    /** 拼接整条 cause 链的类名 + 消息（小写），单串匹配避免逐层判断 */
    private static String collectText(Throwable exception) {
        StringBuilder sb = new StringBuilder();
        Throwable current = exception;
        int depth = 0;
        while (current != null && depth < 8) {
            sb.append(current.getClass().getSimpleName()).append(' ');
            if (current.getMessage() != null) {
                sb.append(current.getMessage()).append(' ');
            }
            current = current.getCause();
            depth++;
        }
        return sb.toString().toLowerCase();
    }

    private static boolean containsAny(String haystack, String... needles) {
        for (String needle : needles) {
            if (haystack.contains(needle)) {
                return true;
            }
        }
        return false;
    }
}
