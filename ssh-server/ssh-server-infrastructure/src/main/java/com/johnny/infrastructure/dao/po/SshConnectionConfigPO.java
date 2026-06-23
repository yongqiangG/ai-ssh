package com.johnny.infrastructure.dao.po;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * SSH 连接高级配置 PO；对应数据表 ssh_connection_config
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SshConnectionConfigPO {

    private Long id;

    /** 连接唯一标识，与 ssh_connection.connection_id 关联 */
    private String connectionId;

    /** 连接超时（毫秒） */
    private Integer connectTimeout;

    /** keepalive 间隔（毫秒） */
    private Integer keepaliveInterval;

    /** 连接后执行的启动命令 */
    private String startupCommand;

    /** 严格主机密钥检查：0 关闭，1 开启 */
    private Integer strictHostKeyCheck;

    /** 已知主机密钥列表 */
    private String knownHosts;

    private Date updatedAt;

}
