package com.johnny.api.dto;

import lombok.Data;

/**
 * ReAct 流式对话事件 DTO —— 前后端流式协议契约。
 *
 * <p>后端在 {@code chat_stream} 中以 NDJSON 形式逐行推送（每行一个本对象的 JSON + '\n'）。
 * 前端 {@code api/chat.ts} 的 {@code streamChat} 按 '\n' 切行、逐行 JSON.parse 后按 {@link #event} 分发。
 *
 * <p>事件类型（{@link #event}）：
 * <ul>
 *   <li><b>text</b>            —— 模型文本片段。{@link #content} 为本次片段，{@link #fullText} 为累积全文（前端用 fullText 整体替换）</li>
 *   <li><b>reasoning</b>       —— 深度思考片段（260723）。{@link #content} 为本次片段，{@link #fullText} 为累积思维链</li>
 *   <li><b>tool_call</b>       —— 工具调用开始</li>
 *   <li><b>tool_result</b>     —— 工具执行结果</li>
 *   <li><b>confirm_request</b> —— 写操作等待用户确认（B1 确认门），携带 {@link #confirmId}，{@link #analysis} 为判定理由</li>
 *   <li><b>round_end</b>       —— 一轮 ReAct 结束，含 {@link StepInfo} 进度</li>
 *   <li><b>done</b>            —— 全部完成，{@link #content} 为最终结果 JSON（ReActResultDTO）</li>
 *   <li><b>error</b>           —— 错误，{@link #content} 为错误信息</li>
 * </ul>
 *
 * <p>本结构与 WaLiSSH 的 ReActEventDTO 完全对齐，便于日后移植其前端时间线渲染。
 */
@Data
public class ReActEventDTO {

    /** 事件类型：text / tool_call / tool_result / confirm_request / round_end / done / error */
    private String event;

    /** 机器可读错误码（event=error 时可选），前端用它处理可恢复协议错误。 */
    private String code;

    /** 事件内容（文本片段 / 工具结果 / 最终结果 JSON / 错误信息） */
    private String content;

    /** 工具调用 ID（tool_call / tool_result 关联键） */
    private String toolCallId;

    /** 工具名称（tool_call 时） */
    private String toolName;

    /** 工具调用状态：pending / running / success / error */
    private String status;

    /** 累积全文（event=text 时，前端据此整体替换，无需自行拼接） */
    private String fullText;

    /** 步数信息（round_end 时） */
    private StepInfo stepInfo;

    /** 错误分析建议（tool_result 失败时，来自工具 analyzeFailure 规则匹配）；confirm_request 时为判定理由 */
    private String analysis;

    /** 确认请求 ID（event=confirm_request 时；前端携带它调 confirm 端点放行/拒绝） */
    private String confirmId;

    /**
     * ReAct 轮次进度信息。
     */
    @Data
    public static class StepInfo {
        /** 当前步数 */
        private int currentStep;
        /** 最大步数 */
        private int maxSteps;
        /** 是否继续执行下一轮 */
        private boolean shouldContinue;
        /** 累计工具调用次数 */
        private int totalToolCalls;
    }
}
