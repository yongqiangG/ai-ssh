package com.johnny.domain.agent.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 配置属性 —— 绑定 application-dev.yml 中 {@code ai.*} 段。
 *
 * <p>对应 yml 结构：
 * <pre>
 * ai:
 *   api:                       # 模型接入（OpenAI 兼容端点）
 *     base-url: https://...
 *     api-key: sk-...
 *     completions-path: v1/chat/completions
 *     model: gpt-4o-mini
 *   agent:                     # 单个智能体（最小闭环只装配一个）
 *     id: sshAssistant
 *     name: sshAssistant       # 同时作为 ADK appName
 *     description: ...
 *     instruction: |           # 系统提示词（多行）
 *       ...
 *     output-key: chat_result  # ADK 写入 session state 的结果 key
 * </pre>
 *
 * <p>注册方式：{@code Application} 上的 {@code @ConfigurationPropertiesScan} 会扫描本类并注册为 Bean，
 * 自动绑定 yml 配置（故此处只需 {@code @ConfigurationProperties}，不加 {@code @Component}）。
 */
@Data
@ConfigurationProperties(prefix = "ai")
public class AiProperties {

    /** 模型接入配置（OpenAI 兼容端点） */
    private Api api;

    /** 智能体配置（最小闭环单 agent） */
    private Agent agent;

    @Data
    public static class Api {
        /** OpenAI 兼容端点 base-url，如 https://api.openai.com 或 https://apis.itedus.cn */
        private String baseUrl;
        /** API Key */
        private String apiKey;
        /** chat completions 路径，默认 v1/chat/completions */
        private String completionsPath;
        /** 模型名，如 gpt-4o-mini / deepseek-chat */
        private String model;
    }

    @Data
    public static class Agent {
        /** 智能体 ID（前端选择与请求携带） */
        private String id;
        /** 智能体名称，同时作为 ADK appName */
        private String name;
        /** 描述 */
        private String description;
        /** 系统提示词 */
        private String instruction;
        /** 输出 key（写入 ADK session state 的键名） */
        private String outputKey;
    }
}
