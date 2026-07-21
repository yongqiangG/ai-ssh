package com.johnny.domain.ssh.adapter.port;

/**
 * SSH 连接参数（凭据 + 高级配置），供 {@link ISshSessionPort#connect(String, ConnectParams)} 使用。
 * <p>字段采用 public 风格，与 {@link ExecResult} 等同包 POJO 一致。
 * 高级配置字段为 null/false 时按实现方默认值处理。
 */
public class ConnectParams {
    public String host;
    public int port;
    public String username;
    /** 密码认证（私钥认证时可为 null） */
    public String password;
    /** 私钥内容 PEM（密码认证时可为 null；提供时优先私钥认证） */
    public String privateKey;
    /** 私钥口令（无口令私钥为 null） */
    public String passphrase;
    /** 连接超时毫秒；null/<=0 用实现默认 */
    public Integer connectTimeout;
    /** keepalive 间隔毫秒（setServerAliveInterval）；null/<=0 不启用 */
    public Integer keepaliveInterval;
    /** 是否启用压缩（zlib@openssh.com） */
    public boolean compression;
    /** 是否严格主机密钥校验（TOFU）；false 保持跳过校验 */
    public boolean strictHostKeyCheck;
    /** 已知主机指纹（OpenSSH known_hosts 行格式）；TOFU 校验数据源 */
    public String knownHosts;
}
