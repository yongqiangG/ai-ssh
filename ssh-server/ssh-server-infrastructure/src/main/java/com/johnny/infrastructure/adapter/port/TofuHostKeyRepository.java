package com.johnny.infrastructure.adapter.port;

import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;
import com.jcraft.jsch.UserInfo;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * TOFU（Trust On First Use）主机密钥仓库：按连接的 knownHosts 内容（OpenSSH 行格式）校验服务器指纹。
 * <p>
 * 未知主机返回 NOT_INCLUDED、指纹不一致返回 CHANGED——两者都会让 JSch 拒绝连接；
 * 拦截现场（算法/指纹/待写入行）记录在 {@link Capture}，由 {@link SshSessionPort} 在连接失败后取出
 * 组装 {@code ConnectResult}，交前端确认后经 accept-hostkey 写库再重连。
 * <p>本类每次连接一次性构造（非 Spring bean），add/remove 为 no-op——写入统一走应用层确认流程。
 */
@Slf4j
public class TofuHostKeyRepository implements HostKeyRepository {

    /** 拦截现场：状态 + 服务器当前密钥信息 + 旧指纹（CHANGED 时） */
    @Getter
    public static class Capture {
        public final int status;
        public final String host;
        public final String keyType;
        public final String fingerprintSha256;
        public final String oldFingerprintSha256;
        public final String knownHostLine;

        Capture(int status, String host, String keyType, String fingerprint, String oldFingerprint, String line) {
            this.status = status;
            this.host = host;
            this.keyType = keyType;
            this.fingerprintSha256 = fingerprint;
            this.oldFingerprintSha256 = oldFingerprint;
            this.knownHostLine = line;
        }
    }

    private final List<HostKey> known = new ArrayList<>();

    @Getter
    private volatile Capture capture;

    /**
     * @param knownHostsContent 连接已存的 known_hosts 内容（每行 host keytype base64key；可空）
     */
    public TofuHostKeyRepository(String knownHostsContent) {
        if (knownHostsContent == null || knownHostsContent.isBlank()) {
            return;
        }
        for (String line : knownHostsContent.split("\\r?\\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                continue;
            }
            String[] parts = trimmed.split("\\s+");
            if (parts.length < 3) {
                log.warn("忽略无法解析的 known_hosts 行: {}", trimmed);
                continue;
            }
            try {
                byte[] keyBytes = Base64.getDecoder().decode(parts[2]);
                known.add(new HostKey(parts[0], keyBytes));
            } catch (Exception e) {
                log.warn("忽略无法解析的 known_hosts 行: {} reason={}", trimmed, e.getMessage());
            }
        }
    }

    @Override
    public int check(String host, byte[] key) {
        String keyType;
        String keyBase64 = Base64.getEncoder().encodeToString(key);
        try {
            keyType = new HostKey(host, key).getType();
        } catch (Exception e) {
            keyType = "unknown";
        }
        String fingerprint = sha256Fingerprint(key);
        String line = host + " " + keyType + " " + keyBase64;

        boolean hostSeen = false;
        String oldFingerprint = null;
        for (HostKey hk : known) {
            if (!hostMatches(hk.getHost(), host) || !hk.getType().equals(keyType)) {
                continue;
            }
            hostSeen = true;
            if (hk.getKey().equals(keyBase64)) {
                return OK;
            }
            oldFingerprint = sha256Fingerprint(Base64.getDecoder().decode(hk.getKey()));
        }
        if (hostSeen) {
            capture = new Capture(CHANGED, host, keyType, fingerprint, oldFingerprint, line);
            log.warn("主机指纹已改变（疑似重装或中间人）host={} type={} new={} old={}",
                    host, keyType, fingerprint, oldFingerprint);
            return CHANGED;
        }
        capture = new Capture(NOT_INCLUDED, host, keyType, fingerprint, null, line);
        log.info("首次遇到主机指纹（待用户确认）host={} type={} fingerprint={}", host, keyType, fingerprint);
        return NOT_INCLUDED;
    }

    /** known_hosts 的 host 字段可含逗号分隔的多个主机名 */
    private boolean hostMatches(String knownHostField, String host) {
        for (String h : knownHostField.split(",")) {
            if (h.equals(host)) {
                return true;
            }
        }
        return false;
    }

    /** OpenSSH 风格指纹：SHA256:去 padding 的 base64 */
    public static String sha256Fingerprint(byte[] key) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(key);
            return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            return "SHA256:" + new String(key, StandardCharsets.ISO_8859_1).hashCode();
        }
    }

    // ===== 写操作 no-op：指纹写入统一走应用层 accept-hostkey 确认流程 =====

    @Override
    public void add(HostKey hostkey, UserInfo ui) {
        // no-op
    }

    @Override
    public void remove(String host, String type) {
        // no-op
    }

    @Override
    public void remove(String host, String type, byte[] key) {
        // no-op
    }

    @Override
    public String getKnownHostsRepositoryID() {
        return "tofu-per-connection";
    }

    @Override
    public HostKey[] getHostKey() {
        return known.toArray(new HostKey[0]);
    }

    @Override
    public HostKey[] getHostKey(String host, String type) {
        List<HostKey> matched = new ArrayList<>();
        for (HostKey hk : known) {
            if (hostMatches(hk.getHost(), host) && (type == null || hk.getType().equals(type))) {
                matched.add(hk);
            }
        }
        return matched.toArray(new HostKey[0]);
    }
}
