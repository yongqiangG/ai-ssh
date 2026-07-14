package com.johnny.domain.react.node;

import com.google.adk.agents.RunConfig;
import com.google.adk.events.Event;
import com.google.adk.runner.Runner;
import com.google.genai.types.Content;
import com.google.genai.types.FunctionCall;
import com.google.genai.types.FunctionResponse;
import com.google.genai.types.Part;
import com.johnny.api.dto.ChatRequestDTO;
import com.johnny.api.dto.ReActResultDTO;
import com.johnny.domain.agent.model.AiAgentRegisterVO;
import com.johnny.domain.agent.service.AgentRunnerRegistry;
import com.johnny.domain.agent.service.tools.TerminalContext;
import com.johnny.domain.react.ReActContext;
import com.johnny.domain.react.engine.StrategyHandler;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;

import java.util.Iterator;
import java.util.Map;

/**
 * AI 调用节点 —— ReAct 循环的核心（外层）。
 *
 * <p><b>方案 B（Q7）</b>：vendored MySpringAI 关闭了 Spring AI 内部工具执行，故多轮
 * 「执行命令 → 观察结果 → 继续推理」全部发生在<b>一次 runAsync 内部</b>（ADK 原生编排）。
 * 本节点只消费事件流：text → text 事件；functionCalls → tool_call；functionResponses → tool_result。
 *
 * <p>外层链保持单步：{@link #get} 返回 {@code defaultStrategyHandler}（无回环节点）。
 * stateDelta 坑随 B 方案消失（functionCall/Response 是一等公民事件），原 TODO 已删除。
 *
 * <p>ITL（§4.9）：doApply 前 set terminalSessionId，finally 无条件 clear。
 */
@Slf4j
@Component("reactAiCallNode")
public class AiCallNode extends AbstractReActSupport {

    @Resource
    private AgentRunnerRegistry agentRunnerRegistry;

    @Override
    protected ReActResultDTO doApply(ChatRequestDTO req, ReActContext ctx) throws Exception {
        AiAgentRegisterVO holder = agentRunnerRegistry.get(ctx.getAgentId());
        Runner runner = holder.getRunner();
        ResponseBodyEmitter emitter = ctx.getEmitter();
        StringBuilder acc = ctx.getAssistantContent();

        // 注册 terminalSessionId（按 ADK sessionId）。取代 ITL：流式 SSE 下工具在池化线程
        // （HttpClient-1-Worker-*）执行，InheritableThreadLocal 继承失效（实测取到 null）。
        final String adkSessionId = ctx.getSessionId();
        TerminalContext.register(adkSessionId, ctx.getTerminalSessionId());

        Content userContent = Content.builder()
                .role("user")
                .parts(Part.builder().text(ctx.getMessage()).build())
                .build();

        // RunConfig 熔断 + 流式：maxLlmCalls=10；streamingMode=SSE 让 ADK 走 MySpringAI 流式路径，
        // LLM 边生成边推 text 事件 → 前端逐步显示（体感优化，避免卡等整段生成完才看到）
        RunConfig runConfig = RunConfig.builder()
                .maxLlmCalls(10)
                .streamingMode(RunConfig.StreamingMode.SSE)
                .build();

        boolean hasError = false;
        String errorMsg = null;

        try {
            // 4 参重载 runAsync(userId, sessionId, content, RunConfig)（反编译 Runner.java:156）
            Iterator<Event> events = runner.runAsync(
                    ctx.getUserId(), ctx.getSessionId(), userContent, runConfig)
                    .blockingIterable()
                    .iterator();

            while (events.hasNext()) {
                Event event = events.next();

                // 1) 纯文本片段 → text 事件。只取 part.text()，避免 stringifyContent 把
                //    functionCall/functionResponse 也当文本混入 AI 回复（出现 "Function Call: ..." 噪声）
                if (event.content().isPresent() && event.content().get().parts().isPresent()) {
                    for (Part p : event.content().get().parts().get()) {
                        String t = p.text().orElse("");
                        if (!t.isEmpty()) {
                            acc.append(t);
                            sendTextEvent(emitter, t, acc.toString());
                        }
                    }
                }

                // 2) functionCalls → tool_call 事件（B 方案：ADK 亲自编排后这是一等公民事件）
                for (FunctionCall fc : event.functionCalls()) {
                    String args = fc.args()
                            .map(a -> a.getOrDefault("command", a).toString())
                            .orElse("");
                    sendToolCallEvent(emitter,
                            fc.id().orElse(""),
                            fc.name().orElse(""),
                            args);
                }

                // 3) functionResponses → tool_result 事件
                for (FunctionResponse fr : event.functionResponses()) {
                    Map<String, Object> resp = fr.response().orElse(Map.of());
                    boolean success = Boolean.TRUE.equals(resp.get("success"));
                    String stdout = String.valueOf(resp.getOrDefault("stdout", ""));
                    String stderr = String.valueOf(resp.getOrDefault("stderr", ""));
                    String analysis = resp.get("analysis") == null ? null : String.valueOf(resp.get("analysis"));
                    String output = success ? stdout : (stderr.isBlank() ? stdout : stdout + "\n[stderr] " + stderr);
                    sendToolResultEvent(emitter,
                            fr.id().orElse(""),
                            fr.name().orElse(""),
                            success ? "success" : "error",
                            output,
                            analysis);
                }
            }
        } catch (Exception e) {
            // maxLlmCalls 熔断（LlmCallsLimitExceededException）也走这里 → error 事件
            log.error("ADK Runner 调用失败", e);
            hasError = true;
            errorMsg = e.getMessage();
        } finally {
            // 清理注册，防内存泄漏
            TerminalContext.register(adkSessionId, null);
        }

        ctx.setStep(ctx.getStep() + 1);
        // totalToolCalls：round_end 前端不渲染（chat.ts 忽略 round_end），传 0 不影响闭环
        sendRoundEndEvent(emitter, ctx.getStep(), ctx.getMaxSteps(), false, 0);

        ReActResultDTO result = ReActResultDTO.builder()
                .content(acc.toString())
                .totalSteps(ctx.getStep())
                .totalToolCalls(0)
                .stopReason(hasError ? "error" : "completed")
                .error(hasError ? errorMsg : null)
                .build();

        if (hasError) {
            sendErrorEvent(emitter, errorMsg);
            emitter.completeWithError(new RuntimeException(errorMsg));
        } else {
            sendDoneEvent(emitter, result);
            emitter.complete();
        }

        log.info("ReAct AiCallNode 完成 step={} contentLen={} error={}",
                ctx.getStep(), acc.length(), hasError);
        return result;
    }

    /** 外层单步：无回环节点（B 方案循环在 runAsync 内）。 */
    @Override
    public StrategyHandler<ChatRequestDTO, ReActContext, ReActResultDTO> get(ChatRequestDTO req, ReActContext ctx) {
        return defaultStrategyHandler;
    }
}
