package com.johnny.trigger.http;

import com.johnny.api.dto.AgentDTO;
import com.johnny.api.dto.ChatRequestDTO;
import com.johnny.api.dto.ConfirmDecisionRequestDTO;
import com.johnny.api.dto.CreateSessionResponseDTO;
import com.johnny.api.response.Response;
import com.johnny.domain.agent.service.AgentRunnerRegistry;
import com.johnny.domain.agent.service.ChatSessionService;
import com.johnny.domain.agent.service.ConfirmGate;
import com.johnny.domain.react.ReActContext;
import com.johnny.domain.react.node.RootNode;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;

import java.util.List;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * AI 对话 HTTP 入口。
 *
 * <p>三个接口构成前端最小闭环：
 * <ul>
 *   <li>{@code GET  /api/v1/agents}      —— 查询已装配智能体列表</li>
 *   <li>{@code POST /api/v1/sessions}    —— 创建（复用）会话，返回 sessionId</li>
 *   <li>{@code POST /api/v1/chat_stream} —— 流式 ReAct 对话，返回 NDJSON 流</li>
 * </ul>
 *
 * <p>{@code chat_stream} 返回 {@link ResponseBodyEmitter} 并立即释放 HTTP 线程；
 * ReAct 责任链提交到共享线程池异步执行，逐事件 emitter.send 写出 NDJSON 行。
 * emitter 的 onError/onTimeout/onCompletion 置 {@link ReActContext} 取消标志，
 * 配合 AiCallNode 的循环检测实现「客户端断开 → 服务端真停」。
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
public class ChatController {

    @Resource
    private AgentRunnerRegistry agentRunnerRegistry;

    @Resource
    private ChatSessionService chatSessionService;

    @Resource
    private RootNode rootNode;

    @Resource
    private ConfirmGate confirmGate;

    /** 共享有界线程池（app 模块 ThreadPoolConfig 装配；拒绝策略 AbortPolicy） */
    @Resource
    private ThreadPoolExecutor threadPoolExecutor;

    /** 查询已装配智能体列表（前端下拉选择）。 */
    @GetMapping("/agents")
    public Response<List<AgentDTO>> agents() {
        return Response.success(agentRunnerRegistry.listAgents());
    }

    /** 创建会话。 */
    @PostMapping("/sessions")
    public Response<CreateSessionResponseDTO> createSession(@RequestBody ChatRequestDTO req) {
        String sessionId = chatSessionService.createSession(req.getAgentId(), req.getUserId());
        return Response.success(CreateSessionResponseDTO.builder().sessionId(sessionId).build());
    }

    /**
     * 写操作确认决定（B1 确认门）：前端用户点「允许/拒绝」后调用，唤醒挂起的工具线程。
     * 返回 false 表示该确认已超时清理或 confirmId 无效（前端提示重试）。
     */
    @PostMapping("/chat/confirm")
    public Response<Boolean> confirm(@RequestBody ConfirmDecisionRequestDTO req) {
        boolean found = confirmGate.decide(req.getConfirmId(), req.isAllow());
        log.info("确认门决定 confirmId={} allow={} found={}", req.getConfirmId(), req.isAllow(), found);
        return Response.success(found);
    }

    /**
     * 流式 ReAct 对话（NDJSON）。
     *
     * <p>流程：建 emitter（3 分钟超时）→ 初始化上下文 → 新线程跑 {@link RootNode} 责任链
     * → 节点经 {@code AbstractReActSupport.sendXxxEvent} 把每条事件以 {@code JSON+"\n"} 写出。
     */
    @PostMapping("/chat_stream")
    public ResponseBodyEmitter chatStream(@RequestBody ChatRequestDTO req) {
        // sessionId 为空则自动创建（与 WaLiSSH 一致）
        if (StringUtils.isBlank(req.getSessionId())) {
            req.setSessionId(chatSessionService.createSession(req.getAgentId(), req.getUserId()));
        }

        log.info("ReAct 流式对话开始 agentId={} userId={} sessionId={}",
                req.getAgentId(), req.getUserId(), req.getSessionId());

        // 10 分钟超时（Q11：多轮工具调用 + LLM 推理可能较长；原 3 分钟）
        ResponseBodyEmitter emitter = new ResponseBodyEmitter(10 * 60 * 1000L);

        // 构造上下文（emitter 塞入，后续节点共享）
        ReActContext ctx = new ReActContext();
        ctx.setEmitter(emitter);

        // 客户端断开 / 超时 / 正常完成 → 置取消标志，AiCallNode 循环检测后中断并 dispose 上游；
        // 断开/超时同时取消该会话挂起的确认门——客户端已不在，没人能点击，别让工具线程空等 120s
        emitter.onError(t -> {
            log.info("chat_stream emitter onError（客户端断开）sessionId={}", req.getSessionId());
            ctx.markCancelled();
            confirmGate.cancelSession(req.getSessionId());
        });
        emitter.onTimeout(() -> {
            log.info("chat_stream emitter onTimeout sessionId={}", req.getSessionId());
            ctx.markCancelled();
            confirmGate.cancelSession(req.getSessionId());
        });
        emitter.onCompletion(() -> ctx.markCancelled());

        // 提交共享线程池执行；池满拒绝时直接以 error 收尾，不吊着客户端
        try {
            threadPoolExecutor.execute(() -> {
                try {
                    rootNode.apply(req, ctx);
                } catch (Exception e) {
                    log.error("ReAct 执行失败", e);
                    emitter.completeWithError(e);
                }
            });
        } catch (RejectedExecutionException e) {
            log.warn("chat_stream 提交被拒绝（线程池饱和）sessionId={}", req.getSessionId());
            emitter.completeWithError(new RuntimeException("服务繁忙，请稍后重试"));
        }

        return emitter;
    }
}
