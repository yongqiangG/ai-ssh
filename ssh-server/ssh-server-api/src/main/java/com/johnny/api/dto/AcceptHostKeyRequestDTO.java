package com.johnny.api.dto;

import lombok.Data;

/**
 * 用户确认主机指纹请求 DTO。
 */
@Data
public class AcceptHostKeyRequestDTO {

    /** 待写入 known_hosts 的完整行（来自 ConnectResultDTO.knownHostLine） */
    private String knownHostLine;
}
