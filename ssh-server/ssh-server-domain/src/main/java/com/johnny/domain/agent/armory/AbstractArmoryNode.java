package com.johnny.domain.agent.armory;

import com.johnny.domain.react.engine.AbstractStrategyRouter;
import jakarta.annotation.Resource;
import org.springframework.context.ApplicationContext;

/**
 * armory 装配节点的公共基类。
 *
 * <p>对应 react 包的 {@code AbstractReActSupport}，但泛型不同：
 * armory 是装配期一次性流程，泛型为 {@code <Void, ArmoryDynamicContext, Void>}——
 * 入参无、上下文透传、无返回值（doApply 返回 null 即可）。
 *
 * <p>节点互引用靠 Spring bean name（{@link #getBean}），框架不持有链结构（与 react 引擎一致）。
 */
public abstract class AbstractArmoryNode
        extends AbstractStrategyRouter<Void, ArmoryDynamicContext, Void> {

    @Resource
    protected ApplicationContext applicationContext;

    /**
     * 按 bean name 取节点 Bean（节点互引用，如 ArmoryRootNode → "armoryAiApiNode"）。
     * 泛型 unchecked，与 react 包 AbstractReActSupport 一致。
     */
    @SuppressWarnings("unchecked")
    protected <T> T getBean(String beanName) {
        return (T) applicationContext.getBean(beanName);
    }
}
