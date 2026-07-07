package com.johnny.api.dto;

import lombok.Data;

/**
 * 终端窗口尺寸调整请求 DTO。
 */
@Data
public class TerminalResizeRequestDTO {

    /** 终端列数 */
    private int cols;

    /** 终端行数 */
    private int rows;
}
