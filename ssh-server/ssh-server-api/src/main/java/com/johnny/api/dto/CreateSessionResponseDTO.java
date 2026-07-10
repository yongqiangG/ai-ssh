package com.johnny.api.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 创建会话响应 DTO。
 *
 * <p>{@code /api/v1/sessions} 成功后返回服务端创建的 sessionId。
 * 该 sessionId 由 ADK {@code SessionService.createSession} 生成，后续 chat_stream 携带它以保持多轮上下文。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateSessionResponseDTO {

    /** 服务端生成的会话 ID */
    private String sessionId;
}
