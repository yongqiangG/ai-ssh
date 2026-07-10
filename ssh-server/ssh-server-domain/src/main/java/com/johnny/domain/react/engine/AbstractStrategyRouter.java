package com.johnny.domain.react.engine;

/**
 * 策略路由抽象类 —— ReAct 引擎的「骨架」。
 *
 * <p>参照 wrench 源码 {@code tree.AbstractStrategyRouter}（已下载核实，核心就 {@link #router} 一个方法）。
 * 一个节点同时是「处理器」（{@link StrategyHandler#apply}）和「路由器」（{@link #get}）。
 *
 * <p><b>核心机制（务必理解）：</b>{@link #router} 只推进 <b>一步</b>——它调用 {@link #get} 拿到下一个节点，
 * 再调用该节点的 {@link #apply}。<b>多步推进靠「节点 doApply 末尾递归调用 router()」实现</b>，
 * 而非框架内置循环。当 {@link #get} 返回 {@code null} 时，走 {@link #defaultStrategyHandler}（返回 null，链终止）。
 *
 * <pre>
 * RootNode.doApply()       { 初始化上下文; return router(p, ctx); }   // → 推进到下一步
 *      └─ router() → get() 返回 AiCallNode → AiCallNode.apply() → doApply()
 *           AiCallNode.doApply() { 调 ADK; 推 SSE; return router(p, ctx); } // → 继续或终止
 *                └─ router() → get() 返回 null → defaultStrategyHandler.apply() → null（链终止）
 * </pre>
 *
 * <p>相比 wrench 的 {@code AbstractMultiThreadStrategyRouter}，这里去掉了 {@code multiThread} 异步预加载钩子
 * （WaLiSSH 实际也未使用——真正的异步在 ServiceCase 用 {@code new Thread} 完成）。
 *
 * @param <T> 请求参数
 * @param <D> 动态上下文
 * @param <R> 返回值
 */
public abstract class AbstractStrategyRouter<T, D, R> implements StrategyHandler<T, D, R> {

    /**
     * 默认（终止）处理器：get() 返回 null 时使用，apply 返回 null 表示链路结束。
     * 用 lambda 直接初始化，类型安全（无需 raw type 的 DEFAULT 常量）。
     */
    protected StrategyHandler<T, D, R> defaultStrategyHandler = (requestParameter, dynamicContext) -> null;

    /**
     * 推进一步：取下一个节点并执行；没有下一个节点则走默认（终止）处理器。
     */
    public R router(T requestParameter, D dynamicContext) throws Exception {
        StrategyHandler<T, D, R> next = get(requestParameter, dynamicContext);
        if (next != null) {
            return next.apply(requestParameter, dynamicContext);
        }
        return defaultStrategyHandler.apply(requestParameter, dynamicContext);
    }

    /**
     * 模板方法：apply 委托给子类的 doApply。
     */
    @Override
    public R apply(T requestParameter, D dynamicContext) throws Exception {
        return doApply(requestParameter, dynamicContext);
    }

    /**
     * 子类实现：本节点的业务逻辑。末尾通常 {@code return router(...)} 推进下一步。
     */
    protected abstract R doApply(T requestParameter, D dynamicContext) throws Exception;

    /**
     * 子类实现：决定下一步去哪个节点（返回其 StrategyHandler）；返回 null 表示终止。
     */
    public abstract StrategyHandler<T, D, R> get(T requestParameter, D dynamicContext) throws Exception;
}
