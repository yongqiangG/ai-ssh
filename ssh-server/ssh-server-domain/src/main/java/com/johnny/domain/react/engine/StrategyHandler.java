package com.johnny.domain.react.engine;

/**
 * 策略处理器接口 —— ReAct 节点「做什么」的契约。
 *
 * <p>这是自写的轻量责任链引擎（不引入 xfg-wrench 依赖）。
 * 参照 wrench 源码 {@code tree.StrategyHandler}（已下载核实，仅 1 个方法）：
 * <ul>
 *   <li>{@code T} —— 请求参数类型</li>
 *   <li>{@code D} —— 动态上下文类型（在节点间透传）</li>
 *   <li>{@code R} —— 返回类型</li>
 * </ul>
 *
 * <p>一个节点 = 一个 {@code StrategyHandler}，其 {@link #apply} 即「这一步的业务」。
 *
 * @param <T> 请求参数
 * @param <D> 动态上下文
 * @param <R> 返回值
 */
public interface StrategyHandler<T, D, R> {

    /**
     * 执行本节点业务。
     *
     * @param requestParameter 请求参数
     * @param dynamicContext   动态上下文
     * @return 处理结果
     */
    R apply(T requestParameter, D dynamicContext) throws Exception;
}
