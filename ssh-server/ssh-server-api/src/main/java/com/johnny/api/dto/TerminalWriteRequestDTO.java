package com.johnny.api.dto;

import lombok.Data;

/**
 * 终端逐字节写入请求 DTO（用户交互场景，按键与控制序列原样透传）。
 */
@Data
public class TerminalWriteRequestDTO {

    /** 原样写入 shell 标准输入的数据（不追加换行） */
    private String data;
}
