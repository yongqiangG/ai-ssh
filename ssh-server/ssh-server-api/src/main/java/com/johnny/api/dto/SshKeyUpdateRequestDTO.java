package com.johnny.api.dto;

import lombok.Data;

/**
 * SSH 密钥更新请求 DTO；字段为 null/空表示不修改（留空不改）。
 */
@Data
public class SshKeyUpdateRequestDTO {

    /** 新名称；留空不改 */
    private String name;
    /** 新私钥内容；留空保持原私钥 */
    private String privateKey;
    /** 新口令；留空保持原口令（清空口令请重建密钥） */
    private String passphrase;
}
