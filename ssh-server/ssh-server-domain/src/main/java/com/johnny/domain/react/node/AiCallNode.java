package com.johnny.domain.react.node;

import com.google.adk.events.Event;
import com.google.adk.runner.Runner;
import com.google.genai.types.Content;
import com.google.genai.types.Part;
import com.johnny.api.dto.ChatRequestDTO;
import com.johnny.api.dto.ReActResultDTO;
import com.johnny.domain.agent.model.RunnerHolder;
import com.johnny.domain.agent.service.AgentRunnerRegistry;
import com.johnny.domain.react.ReActContext;
import com.johnny.domain.react.engine.StrategyHandler;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;

import java.util.Iterator;

/**
 * AI 调用节点 —— ReAct 循环的核心（外层）。
 *
 * <p><b>关于「两层 ReAct」：</b>
 * <ul>
 *   <li><b>内层（ADK）</b>：{@code runner.runAsync} 一次调用内部，ADK（经 SpringAI ChatModel）自己完成
 *       「LLM 推理 → 工具执行 → 再推理」。最小闭环无工具，故内层一次返回最终文本。</li>
 *   <li><b>外层（本节点 + 引擎）</b>：把「一次 runAsync」当作 ReAct 的一步，负责控制步数、推送 SSE、异常兜底。
 *       最小闭环单步即结束；未来加工具后，若单次 runAsync 只走单步（SpringAI call 语义），外层循环负责多步驱动。</li>
 * </ul>
 *
 * <p><b>stateDelta 坑（重要，预留）：</b>SpringAI 的 ChatModel.call() 会自动执行工具，
 * 导致 ADK 事件流里 {@code event.functionCalls()} 为空，工具结果出现在 {@code event.actions().stateDelta()}。
 * <b>最小闭环无工具，暂不触发</b>；加工具时需在此处解析 stateDelta，参照 WaLiSSH {@code AiCallNode:188-248}。
 *
 * <p>本节点流程：取 Runner → runAsync 消费事件流 → 每个文本片段推 {@code text} 事件 → 推 {@code round_end} + {@code done} → complete。
 */
@Slf4j
@Component("reactAiCallNode")
public class AiCallNode extends AbstractReActSupport {

    @Resource
    private AgentRunnerRegistry agentRunnerRegistry;

    @Override
    protected ReActResultDTO doApply(ChatRequestDTO req, ReActContext ctx) throws Exception {
        RunnerHolder holder = agentRunnerRegistry.get(ctx.getAgentId());
        Runner runner = holder.getRunner();
        ResponseBodyEmitter emitter = ctx.getEmitter();
        StringBuilder acc = ctx.getAssistantContent();

        // 构造 ADK 用户消息（google-genai 的 Content/Part）
        Content userContent = Content.builder()
                .role("user")
                .parts(Part.builder().text(ctx.getMessage()).build())
                .build();

        boolean hasError = false;
        String errorMsg = null;

        try {
            // 调用 ADK Runner：返回 rxjava3 Flowable<Event>，blockingIterable 转迭代器逐个消费
            Iterator<Event> events = runner.runAsync(ctx.getUserId(), ctx.getSessionId(), userContent)
                    .blockingIterable()
                    .iterator();

            while (events.hasNext()) {
                Event event = events.next();
                // 取模型文本片段（stringifyContent 返回该事件的文本表示）
                String text = event.stringifyContent();
                if (text != null && !text.isBlank()) {
                    acc.append(text);
                    sendTextEvent(emitter, text, acc.toString());
                }

                // TODO(工具): 加 executeCommand 后，从这里解析工具结果：
                //   EventActions actions = event.actions();
                //   Map<String,Object> delta = actions.stateDelta();  // key=工具 outputKey，value=结果
                //   参照 walissh-server-main/.../react/node/AiCallNode.java:188-248
            }
        } catch (Exception e) {
            log.error("ADK Runner 调用失败", e);
            hasError = true;
            errorMsg = e.getMessage();
        }

        // 步数 +1
        ctx.setStep(ctx.getStep() + 1);

        // 推送本轮结束（最小闭环 shouldContinue=false，不再循环）
        sendRoundEndEvent(emitter, ctx.getStep(), ctx.getMaxSteps(), false, 0);

        // 构造最终结果
        ReActResultDTO result = ReActResultDTO.builder()
                .content(acc.toString())
                .totalSteps(ctx.getStep())
                .totalToolCalls(0)
                .stopReason(hasError ? "error" : "completed")
                .error(hasError ? errorMsg : null)
                .build();

        // 结束流
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

    /**
     * 路由决策。
     *
     * <p>最小闭环：无工具 → 直接返回 {@link #defaultStrategyHandler}（终止，router 会调用其 apply 返回 null）。
     *
     * <p>预留（加工具后）：检测到工具调用时返回 ToolCallNode，其末尾再 router 回本节点形成循环；
     * 达到 maxSteps 或无工具则终止。参照 WaLiSSH {@code AiCallNode:318-347}。
     */
    @Override
    public StrategyHandler<ChatRequestDTO, ReActContext, ReActResultDTO> get(ChatRequestDTO req, ReActContext ctx) {
        return defaultStrategyHandler;
    }
}
