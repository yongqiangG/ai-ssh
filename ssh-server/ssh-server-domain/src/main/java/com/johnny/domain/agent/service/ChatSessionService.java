package com.johnny.domain.agent.service;

import com.google.adk.sessions.Session;
import com.johnny.domain.agent.model.AiAgentRegisterVO;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * AI 会话服务 —— 基于 ADK SessionService 创建/复用会话。
 *
 * <p>{@code createSession} 调 {@code runner.sessionService().createSession(appName, userId)}，
 * 返回 rxjava3 {@code Single<Session>}，用 {@code blockingGet()} 阻塞取值（与 WaLiSSH ChatService 一致）。
 *
 * <p><b>复用策略：</b>与 WaLiSSH 相同，按 userId 复用——同一 userId 多次调用返回同一 sessionId。
 * 最小闭环接受此行为；若需真正多会话，应改为按 (agentId + 随机/时间戳) 生成。
 */
@Slf4j
@Service
public class ChatSessionService {

    @Resource
    private AgentRunnerRegistry agentRunnerRegistry;

    /** userId → sessionId 的内存复用映射（最小闭环；重启即失） */
    private final java.util.Map<String, String> userSessions = new java.util.concurrent.ConcurrentHashMap<>();

    /**
     * 创建（或复用）会话，返回 sessionId。
     *
     * @param agentId 目标智能体
     * @param userId  用户标识
     */
    public String createSession(String agentId, String userId) {
        AiAgentRegisterVO holder = agentRunnerRegistry.get(agentId);

        return userSessions.computeIfAbsent(userId, uid -> {
            // ADK 会话由 SessionService 管理（InMemoryRunner 为内存会话）；appName 作命名空间
            Session session = holder.getRunner().sessionService()
                    .createSession(holder.getAppName(), uid)
                    .blockingGet();
            log.info("创建 AI 会话 agentId={} userId={} sessionId={}", agentId, uid, session.id());
            return session.id();
        });
    }
}
