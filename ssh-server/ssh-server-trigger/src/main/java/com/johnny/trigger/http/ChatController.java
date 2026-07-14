package com.johnny.trigger.http;

import com.johnny.api.dto.AgentDTO;
import com.johnny.api.dto.ChatRequestDTO;
import com.johnny.api.dto.CreateSessionResponseDTO;
import com.johnny.api.response.Response;
import com.johnny.domain.agent.service.AgentRunnerRegistry;
import com.johnny.domain.agent.service.ChatSessionService;
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
 * ReAct 责任链在独立线程异步执行，逐事件 emitter.send 写出 NDJSON 行。
 * 对应 WaLiSSH {@code AgentServiceController.chatStream} + {@code AIAgentReActServiceCase}。
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

        // 异步执行责任链，避免阻塞 Servlet 线程
        String threadName = "react-stream-" + req.getSessionId();
        new Thread(() -> {
            try {
                rootNode.apply(req, ctx);
            } catch (Exception e) {
                log.error("ReAct 执行失败", e);
                emitter.completeWithError(e);
            }
        }, threadName).start();

        return emitter;
    }
}
