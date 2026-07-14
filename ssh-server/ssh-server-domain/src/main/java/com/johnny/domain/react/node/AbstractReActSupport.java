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
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;

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
    // ════════════════════════════════════════════════════════════

    /** 发送文本事件：content 为本次片段，fullText 为累积全文（前端用 fullText 整体替换）。 */
    protected void sendTextEvent(ResponseBodyEmitter emitter, String content, String fullText) {
        try {
            ReActEventDTO event = new ReActEventDTO();
            event.setEvent("text");
            event.setContent(content);
            event.setFullText(fullText);
            emitter.send(JSON.toJSONString(event) + "\n");
        } catch (Exception e) {
            log.warn("发送 text 事件失败: {}", e.getMessage());
        }
    }

    /** 发送轮次结束事件：携带步数进度。 */
    protected void sendRoundEndEvent(ResponseBodyEmitter emitter, int currentStep, int maxSteps,
                                     boolean shouldContinue, int totalToolCalls) {
        try {
            ReActEventDTO.StepInfo stepInfo = new ReActEventDTO.StepInfo();
            stepInfo.setCurrentStep(currentStep);
            stepInfo.setMaxSteps(maxSteps);
            stepInfo.setShouldContinue(shouldContinue);
            stepInfo.setTotalToolCalls(totalToolCalls);

            ReActEventDTO event = new ReActEventDTO();
            event.setEvent("round_end");
            event.setStepInfo(stepInfo);
            emitter.send(JSON.toJSONString(event) + "\n");
        } catch (Exception e) {
            log.warn("发送 round_end 事件失败: {}", e.getMessage());
        }
    }

    /** 发送完成事件：content 为最终结果（ReActResultDTO）的 JSON。 */
    protected void sendDoneEvent(ResponseBodyEmitter emitter, ReActResultDTO result) {
        try {
            ReActEventDTO event = new ReActEventDTO();
            event.setEvent("done");
            event.setContent(JSON.toJSONString(result));
            emitter.send(JSON.toJSONString(event) + "\n");
        } catch (Exception e) {
            log.warn("发送 done 事件失败: {}", e.getMessage());
        }
    }

    /** 发送错误事件。 */
    protected void sendErrorEvent(ResponseBodyEmitter emitter, String message) {
        try {
            ReActEventDTO event = new ReActEventDTO();
            event.setEvent("error");
            event.setContent(message);
            emitter.send(JSON.toJSONString(event) + "\n");
        } catch (Exception e) {
            log.warn("发送 error 事件失败: {}", e.getMessage());
        }
    }

    /** 发送工具调用开始事件（tool_call）：LLM 决定调用工具时。content 为命令文本（args 的 command 字段）。 */
    protected void sendToolCallEvent(ResponseBodyEmitter emitter, String toolCallId, String toolName, String argsText) {
        ReActEventDTO event = new ReActEventDTO();
        event.setEvent("tool_call");
        event.setToolCallId(toolCallId);
        event.setToolName(toolName);
        event.setContent(argsText);
        event.setStatus("running");
        writeNdjson(emitter, event);
    }

    /** 发送工具结果事件（tool_result）：工具执行完成（含成败 + 输出 + 错误分析）。 */
    protected void sendToolResultEvent(ResponseBodyEmitter emitter, String toolCallId, String toolName,
                                       String status, String output, String analysis) {
        ReActEventDTO event = new ReActEventDTO();
        event.setEvent("tool_result");
        event.setToolCallId(toolCallId);
        event.setToolName(toolName);
        event.setStatus(status);           // "success" / "error"
        event.setContent(output);          // stdout（或含 stderr 的错误信息）
        event.setAnalysis(analysis);       // 失败时的中文建议（可能为 null）
        writeNdjson(emitter, event);
    }

    /** 把 ReActEventDTO 序列化成 NDJSON 行（JSON + '\n'）写入 emitter。 */
    private void writeNdjson(ResponseBodyEmitter emitter, ReActEventDTO dto) {
        try {
            emitter.send(JSON.toJSONString(dto) + "\n");
        } catch (Exception e) {
            log.warn("发送 {} 事件失败: {}", dto.getEvent(), e.getMessage());
        }
    }
}
