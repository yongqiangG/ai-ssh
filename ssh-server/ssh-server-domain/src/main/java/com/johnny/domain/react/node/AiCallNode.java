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
import com.johnny.domain.agent.service.tools.ThinkingContext;
import com.johnny.domain.react.ReActContext;
import com.johnny.domain.react.engine.StrategyHandler;
import io.reactivex.rxjava3.disposables.Disposable;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;

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
        StringBuilder acc = ctx.getAssistantContent();

        // 注册 terminalSessionId（按 ADK sessionId）。取代 ITL：流式 SSE 下工具在池化线程
        // （HttpClient-1-Worker-*）执行，InheritableThreadLocal 继承失效（实测取到 null）。
        final String adkSessionId = ctx.getSessionId();
        TerminalContext.register(adkSessionId, ctx.getTerminalSessionId());
        // 消息级思考开关（D1）：runAsync 前置位，finally 复位；拦截器（AiApiNode）读取
        ThinkingContext.set(ctx.isThinkingEnabled());

        // 无绑定终端时注入系统提示：让模型第一轮直接文字回答，
        // 省掉「试探 executeCommand → errorMap → 再转述」的整整一轮 LLM（Q8b）
        String messageText = ctx.getMessage();
        if (StringUtils.isBlank(ctx.getTerminalSessionId())) {
            messageText = messageText
                    + "\n\n[系统提示：当前未连接终端，无法执行命令，请直接以文字回答；"
                    + "若问题必须执行命令才能解答，请告知用户先在终端面板连接服务器。]";
        }

        Content userContent = Content.builder()
                .role("user")
                .parts(Part.builder().text(messageText).build())
                .build();

        // RunConfig 熔断 + 流式：maxLlmCalls=10；streamingMode=SSE 让 ADK 走 MySpringAI 流式路径，
        // LLM 边生成边推 text 事件 → 前端逐步显示（体感优化，避免卡等整段生成完才看到）
        RunConfig runConfig = RunConfig.builder()
                .maxLlmCalls(10)
                .streamingMode(RunConfig.StreamingMode.SSE)
                .build();

        boolean hasError = false;
        String errorMsg = null;
        Iterator<Event> events = null;

        try {
            // 4 参重载 runAsync(userId, sessionId, content, RunConfig)（反编译 Runner.java:156）
            events = runner.runAsync(
                    ctx.getUserId(), ctx.getSessionId(), userContent, runConfig)
                    .blockingIterable()
                    .iterator();

            while (events.hasNext()) {
                // 客户端断开 / 超时 → 中断，不再消费后续事件（也就不再触发下一轮工具执行）
                if (ctx.isCancelled()) {
                    log.info("ReAct 已取消，中断事件循环 sessionId={}", adkSessionId);
                    break;
                }
                Event event = events.next();

                // 1) 纯文本片段 → text 事件。只取 part.text()，避免 stringifyContent 把
                //    functionCall/functionResponse 也当文本混入 AI 回复（出现 "Function Call: ..." 噪声）
                if (event.content().isPresent() && event.content().get().parts().isPresent()) {
                    for (Part p : event.content().get().parts().get()) {
                        String t = p.text().orElse("");
                        if (!t.isEmpty()) {
                            acc.append(t);
                            sendTextEvent(ctx, t, acc.toString());
                        }
                    }
                }

                // 2) functionCalls → tool_call 事件（B 方案：ADK 亲自编排后这是一等公民事件）
                for (FunctionCall fc : event.functionCalls()) {
                    String args = fc.args()
                            .map(a -> a.getOrDefault("command", a).toString())
                            .orElse("");
                    sendToolCallEvent(ctx,
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
                    sendToolResultEvent(ctx,
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
            // 取消/异常时上游 Flowable 可能仍在生产（LLM 流 + 工具编排）——
            // RxJava3 的 BlockingFlowableIterator 实现了 Disposable，显式 dispose 掐断上游
            if (events instanceof Disposable d && !d.isDisposed()) {
                d.dispose();
            }
            // 清理注册，防内存泄漏；思考标志复位为默认关
            TerminalContext.register(adkSessionId, null);
            ThinkingContext.set(false);
        }

        ctx.setStep(ctx.getStep() + 1);

        ReActResultDTO result = ReActResultDTO.builder()
                .content(acc.toString())
                .totalSteps(ctx.getStep())
                .totalToolCalls(0)
                .stopReason(hasError ? "error" : ctx.isCancelled() ? "cancelled" : "completed")
                .error(hasError ? errorMsg : null)
                .build();

        if (ctx.isCancelled()) {
            // 客户端已不在：不再发事件，仅收尾 emitter（幂等，超时场景下容器已完成也不抛）
            try {
                ctx.getEmitter().complete();
            } catch (Exception ignore) {
                // emitter 已由容器关闭
            }
        } else if (hasError) {
            sendErrorEvent(ctx, errorMsg);
            ctx.getEmitter().completeWithError(new RuntimeException(errorMsg));
        } else {
            // totalToolCalls：round_end 前端不渲染（chat.ts 忽略 round_end），传 0 不影响闭环
            sendRoundEndEvent(ctx, ctx.getStep(), ctx.getMaxSteps(), false, 0);
            sendDoneEvent(ctx, result);
            ctx.getEmitter().complete();
        }

        log.info("ReAct AiCallNode 完成 step={} contentLen={} error={} cancelled={}",
                ctx.getStep(), acc.length(), hasError, ctx.isCancelled());
        return result;
    }

    /** 外层单步：无回环节点（B 方案循环在 runAsync 内）。 */
    @Override
    public StrategyHandler<ChatRequestDTO, ReActContext, ReActResultDTO> get(ChatRequestDTO req, ReActContext ctx) {
        return defaultStrategyHandler;
    }
}
