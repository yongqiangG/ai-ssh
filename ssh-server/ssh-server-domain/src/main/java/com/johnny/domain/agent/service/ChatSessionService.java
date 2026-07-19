package com.johnny.domain.agent.service;

import com.google.adk.sessions.Session;
import com.johnny.domain.agent.model.AiAgentRegisterVO;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * AI 会话服务 —— 基于 ADK SessionService 创建会话。
 *
 * <p>{@code createSession} 调 {@code runner.sessionService().createSession(appName, userId)}，
 * 返回 rxjava3 {@code Single<Session>}，用 {@code blockingGet()} 阻塞取值。
 *
 * <p><b>隔离策略（H3）：</b>每次调用都创建全新 ADK 会话——前端每个对话（conversation）
 * 各自 createSession，一一对应各自的上下文历史，「新对话」不再共享旧对话内容。
 * 原按 userId 复用的 map 已删除（曾导致所有前端对话共用一份历史）。
 *
 * <p>TODO：前端删除对话时未通知后端清理对应 ADK 会话（InMemory 实现，进程重启即释放）；
 * 若将来会话持久化，需补删除接口。
 */
@Slf4j
@Service
public class ChatSessionService {

    @Resource
    private AgentRunnerRegistry agentRunnerRegistry;

    /**
     * 创建新会话，返回 sessionId。
     *
     * @param agentId 目标智能体
     * @param userId  用户标识
     */
    public String createSession(String agentId, String userId) {
        AiAgentRegisterVO holder = agentRunnerRegistry.get(agentId);
        // ADK 会话由 SessionService 管理（InMemoryRunner 为内存会话）；appName 作命名空间
        Session session = holder.getRunner().sessionService()
                .createSession(holder.getAppName(), userId)
                .blockingGet();
        log.info("创建 AI 会话 agentId={} userId={} sessionId={}", agentId, userId, session.id());
        return session.id();
    }
}
