package com.johnny.domain.react.node;

import com.alibaba.fastjson2.JSON;
import com.johnny.api.dto.ChatRequestDTO;
import com.johnny.api.dto.ReActEventDTO;
import com.johnny.api.dto.ReActResultDTO;
import com.johnny.domain.react.ReActContext;
import com.johnny.domain.react.engine.AbstractStrategyRouter;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;

/**
 * ReAct 节点公共基类。
 *
 * <p>对应 WaLiSSH 的 {@code AbstractAIAgentReActSupport}，封装两类能力：
 * <ol>
 *   <li>{@link #getBean} —— 按 bean name 取下一个节点（节点间靠 Spring bean name 互引，框架不持有链结构）</li>
 *   <li>{@code sendXxxEvent} —— 把 {@link ReActEventDTO} 序列化成 NDJSON 行（JSON + '\n'）写入 emitter</li>
 * </ol>
 *
 * <p>序列化用项目已有的 fastjson（domain 模块无 jackson 依赖）。每行 = 一个事件 JSON + 换行，
 * 前端 {@code streamChat} 按 {@code \n} 切行、逐行 JSON.parse。
 */
@Slf4j
public abstract class AbstractReActSupport
        extends AbstractStrategyRouter<ChatRequestDTO, ReActContext, ReActResultDTO> {

    @Resource
    protected ApplicationContext applicationContext;

    /**
     * 按 bean name 取节点 Bean（节点互引用，如 RootNode → "reactAiCallNode"）。
     * 泛型 unchecked，与 wrench/WaLiSSH 一致。
     */
    @SuppressWarnings("unchecked")
    protected <T> T getBean(String beanName) {
        return (T) applicationContext.getBean(beanName);
    }

    // ════════════════════════════════════════════════════════════
    //  NDJSON 事件发射（每条 = JSON + '\n'）
    //  发送失败（客户端断开 / emitter 超时后）置 ctx.cancelled，
    //  由 AiCallNode 事件循环检测后中断 ReAct。
    // ════════════════════════════════════════════════════════════

    /** 发送文本事件：content 为本次片段，fullText 为累积全文（前端用 fullText 整体替换）。 */
    protected void sendTextEvent(ReActContext ctx, String content, String fullText) {
        ReActEventDTO event = new ReActEventDTO();
        event.setEvent("text");
        event.setContent(content);
        event.setFullText(fullText);
        writeNdjson(ctx, event);
    }

    /** 发送轮次结束事件：携带步数进度。 */
    protected void sendRoundEndEvent(ReActContext ctx, int currentStep, int maxSteps,
                                     boolean shouldContinue, int totalToolCalls) {
        ReActEventDTO.StepInfo stepInfo = new ReActEventDTO.StepInfo();
        stepInfo.setCurrentStep(currentStep);
        stepInfo.setMaxSteps(maxSteps);
        stepInfo.setShouldContinue(shouldContinue);
        stepInfo.setTotalToolCalls(totalToolCalls);

        ReActEventDTO event = new ReActEventDTO();
        event.setEvent("round_end");
        event.setStepInfo(stepInfo);
        writeNdjson(ctx, event);
    }

    /** 发送完成事件：content 为最终结果（ReActResultDTO）的 JSON。 */
    protected void sendDoneEvent(ReActContext ctx, ReActResultDTO result) {
        ReActEventDTO event = new ReActEventDTO();
        event.setEvent("done");
        event.setContent(JSON.toJSONString(result));
        writeNdjson(ctx, event);
    }

    /** 发送错误事件。 */
    protected void sendErrorEvent(ReActContext ctx, String message) {
        ReActEventDTO event = new ReActEventDTO();
        event.setEvent("error");
        event.setContent(message);
        writeNdjson(ctx, event);
    }

    /** 发送工具调用开始事件（tool_call）：LLM 决定调用工具时。content 为命令文本（args 的 command 字段）。 */
    protected void sendToolCallEvent(ReActContext ctx, String toolCallId, String toolName, String argsText) {
        ReActEventDTO event = new ReActEventDTO();
        event.setEvent("tool_call");
        event.setToolCallId(toolCallId);
        event.setToolName(toolName);
        event.setContent(argsText);
        event.setStatus("running");
        writeNdjson(ctx, event);
    }

    /** 发送工具结果事件（tool_result）：工具执行完成（含成败 + 输出 + 错误分析）。 */
    protected void sendToolResultEvent(ReActContext ctx, String toolCallId, String toolName,
                                       String status, String output, String analysis) {
        ReActEventDTO event = new ReActEventDTO();
        event.setEvent("tool_result");
        event.setToolCallId(toolCallId);
        event.setToolName(toolName);
        event.setStatus(status);           // "success" / "error"
        event.setContent(output);          // stdout（或含 stderr 的错误信息）
        event.setAnalysis(analysis);       // 失败时的中文建议（可能为 null）
        writeNdjson(ctx, event);
    }

    /** 把 ReActEventDTO 序列化成 NDJSON 行（JSON + '\n'）写入 emitter；失败视为客户端已断开 → 置取消标志。 */
    private void writeNdjson(ReActContext ctx, ReActEventDTO dto) {
        if (ctx.isCancelled()) {
            return;
        }
        try {
            ctx.getEmitter().send(JSON.toJSONString(dto) + "\n");
        } catch (Exception e) {
            log.info("发送 {} 事件失败（客户端断开或超时），标记取消: {}", dto.getEvent(), e.getMessage());
            ctx.markCancelled();
        }
    }
}
