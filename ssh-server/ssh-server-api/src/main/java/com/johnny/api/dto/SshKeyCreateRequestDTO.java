package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 密钥创建请求 DTO。
 */
@Data
public class SshKeyCreateRequestDTO {

    /** 密钥名称（必填，最长 64） */
    private String name;
    /** 私钥内容（PEM，必填） */
    private String privateKey;
    /** 私钥口令（可选，无口令私钥留空） */
    private String passphrase;
}
