package com.johnny.domain.ssh.adapter.port;

/**
 * SSH 连接尝试的结构化结果（TOFU 主机指纹流程的载体）。
 * <p>
 * {@code success=false} 且 {@code hostKeyStatus} 非空时，表示连接被主机密钥校验拦下：
 * UNKNOWN=首次遇到该主机（前端弹确认卡片），CHANGED=指纹与已知记录不一致（疑似重装或中间人，红色警告）。
 * 用户确认后经 accept-hostkey 写入 knownHosts 再重连。
 * <p>字段采用 public 风格，与同包 {@link ExecResult}/{@link ConnectParams} 一致。
 */
public class ConnectResult {
    /** 连接是否成功建立 */
    public boolean success;
    /** 主机密钥拦截状态：UNKNOWN / CHANGED；非指纹原因的失败为 null */
    public String hostKeyStatus;
    /** 目标主机（known_hosts 记录形式，非 22 端口为 [host]:port） */
    public String host;
    /** 密钥算法类型，如 ssh-ed25519 / ssh-rsa */
    public String keyType;
    /** 服务器当前指纹（OpenSSH 格式 SHA256:base64） */
    public String fingerprintSha256;
    /** 已知记录的旧指纹（仅 CHANGED 时有值） */
    public String oldFingerprintSha256;
    /** 待写入 known_hosts 的完整行（host keytype base64key）；用户确认后由 accept-hostkey 落库 */
    public String knownHostLine;
    /** 非指纹原因失败时的简述（可空） */
    public String error;

    public static ConnectResult ok() {
        ConnectResult r = new ConnectResult();
        r.success = true;
        return r;
    }

    public static ConnectResult fail(String error) {
        ConnectResult r = new ConnectResult();
        r.success = false;
        r.error = error;
        return r;
    }
}
