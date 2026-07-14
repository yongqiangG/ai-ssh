package com.johnny.domain.agent.armory;

import com.google.adk.agents.LlmAgent;
import com.google.adk.runner.Runner;
import com.google.adk.tools.FunctionTool;
import com.johnny.domain.agent.bridge.springai.MySpringAI;
import com.johnny.domain.agent.config.AgentConfigProperties.AgentTable;
import lombok.Data;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.openai.api.OpenAiApi;

import java.util.ArrayList;
import java.util.List;

/**
 * armory 装配责任链的动态上下文，在各节点间透传半成品对象。
 *
 * <p>每个节点把产出塞进对应字段，下游节点消费。
 * 对应 {@code AbstractStrategyRouter<Void, ArmoryDynamicContext, Void>} 的 D。
 */
@Data
public class ArmoryDynamicContext {

    /** 本次装配的 agent 配置表（来自 ssh-agent.yml 的一个 table） */
    private AgentTable table;

    /** AiApiNode 产出 */
    private OpenAiApi openAiApi;

    /** ChatModelNode 产出（Spring AI 的 ChatModel） */
    private ChatModel chatModel;

    /** AgentNode 产出：vendored 桥接（§4.3） */
    private MySpringAI springAI;

    /** AgentNode 产出 */
    private LlmAgent llmAgent;

    /** AgentWorkflowNode 产出（单 agent 直通，= llmAgent） */
    private LlmAgent workflowAgent;

    /** RunnerNode 产出 */
    private Runner runner;

    /** 装配过程中创建的 FunctionTool（调试用） */
    private List<FunctionTool> tools = new ArrayList<>();
}
