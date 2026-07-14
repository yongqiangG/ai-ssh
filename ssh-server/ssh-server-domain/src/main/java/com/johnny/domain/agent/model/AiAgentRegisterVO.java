package com.johnny.domain.agent.model;

import com.google.adk.runner.Runner;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Agent 注册值对象：装配产物，由 {@code RunnerNode} 动态注册进 Spring 容器
 * （bean 名 {@code aiAgentRunner_<agentId>}）。
 *
 * <p>原 {@code RunnerHolder} 的更名（原注释即写明是 AiAgentRegisterVO 的裁剪版，属对齐而非新造）。
 *
 * <p><b>⚠️ registerSingleton 陷阱：</b>refresh 之后的裸注册<b>不走 Bean 生命周期</b>——
 * 无代理、无 @PostConstruct、无 @Autowired 重新注入。对纯数据 VO 无害，
 * 但<b>今后不得往 VO 里塞需要 AOP / 依赖注入的东西</b>。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiAgentRegisterVO {
    private String agentId;
    /** ADK appName（会话命名空间） */
    private String appName;
    private String agentName;
    private String agentDesc;
    /** com.google.adk.runner.Runner，ADK 执行引擎 */
    private Runner runner;
}
