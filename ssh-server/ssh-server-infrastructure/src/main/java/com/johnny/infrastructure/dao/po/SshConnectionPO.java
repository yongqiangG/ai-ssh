package com.johnny.infrastructure.dao.po;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * SSH 连接基础配置 PO；对应数据表 ssh_connection
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SshConnectionPO {

    private Long id;

    /** 连接唯一标识（UUID） */
    private String connectionId;

    /** 连接显示名 */
    private String name;

    private String host;

    private Integer port;

    private String username;

    /** 认证类型：PASSWORD / PUBLIC_KEY */
    private String authType;

    private String password;

    /** SSH 私钥（PEM 内容）；已迁移到密钥实体的连接此列为空 */
    private String privateKey;

    /** 引用的密钥实体 keyId（PUBLIC_KEY 认证）；密码认证为空 */
    private String keyId;

    private String userId;

    private Date createdAt;

    private Date updatedAt;

    /** 逻辑删除：0 未删，1 已删 */
    private Integer deleted;

}
