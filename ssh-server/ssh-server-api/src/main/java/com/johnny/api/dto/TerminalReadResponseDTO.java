package com.johnny.api.dto;

import lombok.Data;

/**
 * 终端输出读取响应 DTO（前端轮询拉取增量输出）。
 */
@Data
public class TerminalReadResponseDTO {

    /** 自上次读取以来的增量输出；无新输出为空字符串 */
    private String content;

    /** 后端断联标记：shell 通道已关闭时为 true，前端应停止轮询并提示断开 */
    private boolean closed;
}
