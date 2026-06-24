package com.johnny.infrastructure.adapter.port;

import com.johnny.domain.ssh.adapter.port.ISecretCipher;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-256-GCM 加解密实现。
 * <p>
 * 密文格式：{@code v1:} + Base64( IV(12) || ciphertext+tag )。每次加密使用随机 IV，相同明文每次密文不同。
 * <p>
 * 密钥来源：优先读取配置 {@code ssh.crypto.secret-key}（Base64 编码的 32 字节）；
 * 生产环境（prod profile）缺失则启动失败（fail fast）；开发/测试环境缺失时回退到内置默认密钥并打印警告。
 */
@Slf4j
@Component
public class AesGcmSecretCipher implements ISecretCipher {

    /** 密文版本前缀，便于将来密钥/算法轮换 */
    private static final String VERSION_PREFIX = "v1:";
    /** GCM 推荐 IV 长度（字节） */
    private static final int IV_LENGTH = 12;
    /** GCM 认证 tag 长度（位） */
    private static final int TAG_LENGTH_BITS = 128;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String ALGORITHM = "AES";

    /**
     * 开发环境默认密钥（Base64 编码的 32 字节）。
     * ONLY FOR DEV/TEST - DO NOT USE IN PRODUCTION.
     */
    static final String DEV_DEFAULT_KEY = "ZGV2X2RlZmF1bHRfc2VjcmV0X2tleV8zMmJ5dGVzISE=";

    private final Environment environment;

    @Value("${ssh.crypto.secret-key:}")
    private String configuredKey;

    private SecretKeySpec keySpec;
    private final SecureRandom secureRandom = new SecureRandom();

    public AesGcmSecretCipher(Environment environment) {
        this.environment = environment;
    }

    @PostConstruct
    void initKey() {
        byte[] keyBytes;
        if (configuredKey != null && !configuredKey.isEmpty()) {
            keyBytes = decodeKey(configuredKey);
        } else if (environment.acceptsProfiles(Profiles.of("prod"))) {
            throw new IllegalStateException("生产环境必须配置 ssh.crypto.secret-key（环境变量 SSH_SECRET_KEY），且为 Base64 编码的 32 字节密钥");
        } else {
            log.warn("未配置 ssh.crypto.secret-key，开发/测试环境使用内置默认密钥。切勿用于生产！");
            keyBytes = decodeKey(DEV_DEFAULT_KEY);
        }
        this.keySpec = new SecretKeySpec(keyBytes, ALGORITHM);
    }

    private byte[] decodeKey(String base64) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("ssh.crypto.secret-key 不是合法的 Base64 字符串", e);
        }
        if (bytes.length != 32) {
            throw new IllegalStateException("ssh.crypto.secret-key 解码后必须为 32 字节（AES-256），实际: " + bytes.length);
        }
        return bytes;
    }

    @Override
    public String encrypt(String plaintext) {
        if (plaintext == null || plaintext.isEmpty()) {
            return plaintext;
        }
        try {
            byte[] iv = new byte[IV_LENGTH];
            secureRandom.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new GCMParameterSpec(TAG_LENGTH_BITS, iv));

            byte[] cipherText = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] combined = new byte[iv.length + cipherText.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(cipherText, 0, combined, iv.length, cipherText.length);

            return VERSION_PREFIX + Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            throw new IllegalStateException("加密失败", e);
        }
    }

    @Override
    public String decrypt(String ciphertext) {
        if (ciphertext == null || ciphertext.isEmpty()) {
            return ciphertext;
        }
        String payload = ciphertext.startsWith(VERSION_PREFIX)
                ? ciphertext.substring(VERSION_PREFIX.length())
                : ciphertext;
        try {
            byte[] combined = Base64.getDecoder().decode(payload);
            if (combined.length <= IV_LENGTH) {
                throw new IllegalStateException("密文长度非法");
            }
            byte[] iv = new byte[IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, IV_LENGTH);
            byte[] cipherText = new byte[combined.length - IV_LENGTH];
            System.arraycopy(combined, IV_LENGTH, cipherText, 0, cipherText.length);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, keySpec, new GCMParameterSpec(TAG_LENGTH_BITS, iv));

            return new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("解密失败", e);
        }
    }
}
