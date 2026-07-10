package com.johnny.api.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 智能体信息 DTO。
 *
 * <p>{@code /api/v1/agents} 返回当前服务端装配好的智能体列表，供前端下拉选择。
 * 对应前端 {@code types.Agent}（id/name/description）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AgentDTO {

    /** 智能体 ID（前端发送消息时携带） */
    private String agentId;

    /** 智能体展示名称 */
    private String agentName;

    /** 智能体描述 */
    private String agentDesc;
}
