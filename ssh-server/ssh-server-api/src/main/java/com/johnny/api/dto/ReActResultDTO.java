package com.johnny.api.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * ReAct 执行结果 DTO。
 *
 * <p>外层 ReAct 责任链执行完毕后产出，作为 {@code done} 事件的 content（JSON 字符串）推送给前端。
 * 前端最小闭环主要取 {@link #content} 作为最终回复。
 *
 * <p>对齐 WaLiSSH 的 ReActResultDTO（裁剪了 toolCalls/toolResults 列表——最小闭环无工具）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReActResultDTO {

    /** 最终回复内容（模型文本） */
    private String content;

    /** 总执行步数（一次 runAsync 算一步） */
    private int totalSteps;

    /** 总工具调用次数（最小闭环恒为 0） */
    private int totalToolCalls;

    /** 是否因达到最大步数终止 */
    private boolean maxStepsReached;

    /** 是否用户手动停止（前端 abort；最小闭环前端暂未实现停止按钮） */
    private boolean userStopped;

    /** 是否 idle 超时终止 */
    private boolean idleTimeout;

    /** 终止原因：completed / finish / max_steps / user_stop / idle_timeout / error */
    private String stopReason;

    /** 错误信息（如有） */
    private String error;
}
