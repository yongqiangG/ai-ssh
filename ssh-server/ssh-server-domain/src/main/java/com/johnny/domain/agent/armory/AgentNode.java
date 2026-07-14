package com.johnny.domain.agent.armory;

import com.google.adk.agents.LlmAgent;
import com.google.adk.tools.FunctionTool;
import com.johnny.domain.agent.bridge.springai.MySpringAI;
import com.johnny.domain.agent.config.AgentConfigProperties;
import com.johnny.domain.agent.service.tools.SshExecuteAdkTool;
import com.johnny.domain.react.engine.StrategyHandler;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 用 vendored {@link MySpringAI} 桥接构建 {@link LlmAgent}，注册 {@code executeCommand} 工具。
 *
 * <p>依赖 {@link SshExecuteAdkTool}（§4.2）——Spring 注入。
 * 关键：{@code FunctionTool.create(sshExecuteAdkTool, "executeCommand")} 注册实例方法工具。
 */
@Slf4j
@Component("armoryAgentNode")
public class AgentNode extends AbstractArmoryNode {

    @Resource
    private SshExecuteAdkTool sshExecuteAdkTool;

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentConfigProperties.Module module = ctx.getTable().getModule();
        AgentConfigProperties.Module.AgentDef agentDef = module.getAgents().get(0);  // 单 agent：取第一个

        // vendored 桥接（§4.3）：关闭内部工具执行 + 修正 functionResponse→ToolResponseMessage
        MySpringAI springAI = new MySpringAI(ctx.getChatModel());
        FunctionTool tool = FunctionTool.create(sshExecuteAdkTool, "executeCommand");
        ctx.getTools().add(tool);

        LlmAgent llmAgent = LlmAgent.builder()
                .name(agentDef.getName())
                .description(agentDef.getDescription())
                .model(springAI)
                .instruction(agentDef.getInstruction())
                .outputKey(agentDef.getOutputKey())
                .tools(List.of(tool))   // tools(List<?>)，反编译 LlmAgent.java:485
                .build();
        ctx.setSpringAI(springAI);
        ctx.setLlmAgent(llmAgent);
        log.info("armory[AgentNode] 完成 agentName={} tools=[executeCommand]", agentDef.getName());
        return router(p, ctx);
    }

    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return getBean("armoryAgentWorkflowNode");
    }
}
