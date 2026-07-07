package com.johnny.api.dto;

import lombok.Data;

/**
 * 终端整行命令请求 DTO（AI 执行命令场景，服务端自动补换行）。
 */
@Data
public class TerminalCommandRequestDTO {

    /** 要执行的整行命令 */
    private String command;
}
