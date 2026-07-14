package com.johnny.domain.agent.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;
import java.util.Map;

/**
 * ssh-agent.yml 的绑定类（prefix = ai.agent.config）。
 *
 * <p>对应 yml 结构（Spring relaxed binding：app-name→appName 等）：
 * <pre>
 * ai.agent.config.tables.<tableName>:
 *   app-name / agent{agent-id,agent-name,agent-desc} / module{ai-api,chat-model,agents[]} / runner{agent-name,plugin-name-list[]}
 * </pre>
 *
 * <p>注册方式：{@code Application} 上的 {@code @ConfigurationPropertiesScan} 自动扫描注册（与旧 AiProperties 同机制）。
 * 替代旧 AiProperties（§4.11 删除）。
 */
@Data
@ConfigurationProperties(prefix = "ai.agent.config")
public class AgentConfigProperties {

    /** key = table 名（如 "sshAgent"），支持多 agent 配置 */
    private Map<String, AgentTable> tables;

    @Data
    public static class AgentTable {
        private String appName;
        private Agent agent;
        private Module module;
        private Runner runner;
    }

    @Data
    public static class Agent {
        /** agentId 保持 String（注册表 key / DTO / 前端全字符串，Q10） */
        private String agentId;
        private String agentName;
        private String agentDesc;
    }

    @Data
    public static class Module {
        private AiApi aiApi;
        private ChatModel chatModel;
        private List<AgentDef> agents;

        @Data
        public static class AiApi {
            private String baseUrl;
            private String apiKey;
            private String completionsPath;
        }

        /** ⚠️ 与 org.springframework.ai.chat.model.ChatModel 同名——引用时用全限定区分 */
        @Data
        public static class ChatModel {
            private String model;
        }

        @Data
        public static class AgentDef {
            private String name;
            private String description;
            private String instruction;
            private String outputKey;
        }
    }

    @Data
    public static class Runner {
        /** ADK appName（会话命名空间） */
        private String agentName;
        private List<String> pluginNameList;
    }
}
