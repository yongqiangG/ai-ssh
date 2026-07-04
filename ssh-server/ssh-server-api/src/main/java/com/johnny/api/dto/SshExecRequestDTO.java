package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 命令执行请求 DTO。
 */
@Data
public class SshExecRequestDTO {

    /** 要在远端执行的单条命令 */
    private String command;
}
