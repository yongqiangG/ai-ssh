package com.johnny.api.dto;

import lombok.Data;

/**
 * AI 对话请求 DTO。
 *
 * <p>用于 {@code /api/v1/sessions}（仅需 agentId/userId）与 {@code /api/v1/chat_stream}（全字段）。
 * 字段与前端 {@code api/chat.ts} 的请求体一一对应。
 *
 * <ul>
 *   <li>agentId —— 目标智能体 ID（来自 {@code queryAgents} 返回）</li>
 *   <li>userId  —— 用户标识，无鉴权阶段前端固定传 "default"（见 request.ts getUserId）</li>
 *   <li>sessionId —— ADK 会话 ID；为空时后端会自动创建</li>
 *   <li>message —— 本轮用户消息</li>
 * </ul>
 */
@Data
public class ChatRequestDTO {

    /** 智能体 ID */
    private String agentId;

    /** 用户 ID（无鉴权阶段缺省 "default"） */
    private String userId;

    /** 会话 ID（可空，空则后端自动创建） */
    private String sessionId;

    /** 用户消息内容 */
    private String message;

    /** 当前绑定的终端会话 id（可空，无活跃终端时不带；后端据此让工具定位 SSH 连接） */
    private String terminalSessionId;
}
