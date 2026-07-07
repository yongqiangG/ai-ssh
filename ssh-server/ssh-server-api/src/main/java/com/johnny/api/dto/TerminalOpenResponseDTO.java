package com.johnny.api.dto;

import lombok.Data;

/**
 * 打开终端会话响应 DTO。
 */
@Data
public class TerminalOpenResponseDTO {

    /** 终端会话唯一标识，后续读写/调整尺寸/关闭均以此寻址 */
    private String sessionId;

    /** 初始输出（motd + 首个提示符），服务端积累完毕后一次性返回 */
    private String output;
}
