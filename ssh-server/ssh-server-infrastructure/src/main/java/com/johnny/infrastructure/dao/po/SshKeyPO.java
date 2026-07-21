package com.johnny.infrastructure.dao.po;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * SSH 密钥 PO；对应数据表 ssh_key
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SshKeyPO {

    private Long id;

    /** 密钥唯一标识（UUID） */
    private String keyId;

    /** 密钥显示名 */
    private String name;

    /** SSH 私钥（PEM 内容，AES-GCM 密文落库） */
    private String privateKey;

    /** 私钥口令（AES-GCM 密文落库；无口令为空） */
    private String passphrase;

    private String userId;

    private Date createdAt;

    private Date updatedAt;

    /** 逻辑删除：0 未删，1 已删 */
    private Integer deleted;

}
