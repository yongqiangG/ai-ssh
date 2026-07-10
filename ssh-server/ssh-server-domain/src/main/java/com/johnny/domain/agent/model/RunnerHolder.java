package com.johnny.domain.agent.model;

import com.google.adk.runner.Runner;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 已装配 Agent 的运行时句柄。
 *
 * <p>启动时由 {@code AgentRunnerRegistry} 构建，包含 ADK {@link Runner} 及其元信息。
 * 对应 WaLiSSH 的 {@code AiAgentRegisterVO}——这里裁剪为最小闭环所需字段。
 *
 * <ul>
 *   <li>{@link #runner} —— ADK 执行入口，{@code runAsync} 驱动 ReAct</li>
 *   <li>{@link #appName} —— ADK 会话命名空间（建会话时用）</li>
 * </ul>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RunnerHolder {

    /** 智能体 ID */
    private String agentId;

    /** ADK appName（会话命名空间） */
    private String appName;

    /** 智能体展示名 */
    private String agentName;

    /** 智能体描述 */
    private String agentDesc;

    /** ADK Runner（执行引擎） */
    private Runner runner;
}
