package com.johnny.domain.agent.armory;

import com.google.adk.plugins.Plugin;
import com.google.adk.runner.InMemoryRunner;
import com.google.adk.runner.Runner;
import com.johnny.domain.agent.config.AgentConfigProperties;
import com.johnny.domain.agent.model.AiAgentRegisterVO;
import com.johnny.domain.react.engine.StrategyHandler;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 装配终点：构建 {@link InMemoryRunner}；按 {@code plugin-name-list} 逐个 getBean 注册插件；
 * 把 runner 包成 {@link AiAgentRegisterVO}，{@code beanFactory.registerSingleton} 动态注册进容器（Q5）。
 */
@Slf4j
@Component("armoryRunnerNode")
public class RunnerNode extends AbstractArmoryNode {

    @Resource
    private ConfigurableListableBeanFactory beanFactory;
    @Resource
    private ApplicationContext applicationContext;

    @Override
    protected Void doApply(Void p, ArmoryDynamicContext ctx) throws Exception {
        AgentConfigProperties.AgentTable table = ctx.getTable();
        String appName = table.getRunner().getAgentName();   // appName = agent name

        // 按 plugin-name-list 逐个 getBean 装配插件（Q8）
        List<Plugin> plugins = new ArrayList<>();
        for (String name : table.getRunner().getPluginNameList()) {
            plugins.add(applicationContext.getBean(name, Plugin.class));
        }

        Runner runner = new InMemoryRunner(ctx.getWorkflowAgent(), appName, plugins);  // 反编译 InMemoryRunner.java:25
        ctx.setRunner(runner);

        // 包成 VO + 动态注册（registerSingleton，见 AiAgentRegisterVO 类注释警示）
        AiAgentRegisterVO vo = AiAgentRegisterVO.builder()
                .agentId(table.getAgent().getAgentId())
                .appName(appName)
                .agentName(table.getAgent().getAgentName())
                .agentDesc(table.getAgent().getAgentDesc())
                .runner(runner)
                .build();
        String beanName = "aiAgentRunner_" + table.getAgent().getAgentId();
        if (beanFactory instanceof DefaultListableBeanFactory defaultFactory && defaultFactory.containsSingleton(beanName)) {
            defaultFactory.destroySingleton(beanName);
        }
        beanFactory.registerSingleton(beanName, vo);
        log.info("armory[RunnerNode] 完成 agentId={} beanName={} plugins={}",
                table.getAgent().getAgentId(), beanName, table.getRunner().getPluginNameList());
        return router(p, ctx);   // get() 返回 defaultStrategyHandler → 链终止
    }

    @Override
    public StrategyHandler<Void, ArmoryDynamicContext, Void> get(Void p, ArmoryDynamicContext ctx) {
        return defaultStrategyHandler;   // 终点：返回终止处理器（apply 返回 null）
    }
}
