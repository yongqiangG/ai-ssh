package com.johnny.api.dto;

import lombok.Data;

/**
 * 打开终端会话请求 DTO。
 */
@Data
public class TerminalOpenRequestDTO {

    /** 目标 SSH 连接标识（必须已建立连接） */
    private String connectionId;

    /** 终端列数（前端 xterm 实际尺寸；缺省由服务端取默认值） */
    private int cols;

    /** 终端行数 */
    private int rows;
}
