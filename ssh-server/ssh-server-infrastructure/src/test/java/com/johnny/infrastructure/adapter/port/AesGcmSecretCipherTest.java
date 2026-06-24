package com.johnny.infrastructure.adapter.port;

import org.junit.Before;
import org.junit.Test;

import javax.crypto.spec.SecretKeySpec;
import java.lang.reflect.Field;
import java.util.Base64;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * AES-256-GCM 加解密测试；通过反射注入 dev 默认密钥，绕过 Spring 装配。
 */
public class AesGcmSecretCipherTest {

    private AesGcmSecretCipher cipher;

    @Before
    public void setUp() throws Exception {
        cipher = new AesGcmSecretCipher(null);
        // 直接注入 dev 默认密钥，跳过 @Value / @PostConstruct
        SecretKeySpec keySpec = new SecretKeySpec(
                Base64.getDecoder().decode(AesGcmSecretCipher.DEV_DEFAULT_KEY), "AES");
        Field f = AesGcmSecretCipher.class.getDeclaredField("keySpec");
        f.setAccessible(true);
        f.set(cipher, keySpec);
    }

    @Test
    public void encrypt_decrypt_roundtrip() {
        String plain = "my-secret-password-中文测试";
        String encrypted = cipher.encrypt(plain);
        assertNotEquals(plain, encrypted);
        assertTrue("密文应带版本前缀", encrypted.startsWith("v1:"));
        assertEquals(plain, cipher.decrypt(encrypted));
    }

    @Test
    public void encrypt_random_iv_each_time() {
        String plain = "same-password";
        String a = cipher.encrypt(plain);
        String b = cipher.encrypt(plain);
        assertNotEquals("相同明文每次密文应不同（随机IV）", a, b);
        assertEquals(plain, cipher.decrypt(a));
        assertEquals(plain, cipher.decrypt(b));
    }

    @Test
    public void encrypt_null_or_empty_passthrough() {
        assertNull(cipher.encrypt(null));
        assertEquals("", cipher.encrypt(""));
        assertNull(cipher.decrypt(null));
        assertEquals("", cipher.decrypt(""));
    }

    @Test(expected = RuntimeException.class)
    public void decrypt_invalid_ciphertext_throws() {
        // "AAAA" 解码仅 3 字节，小于 IV 长度 12，触发密文长度非法
        cipher.decrypt("v1:AAAA");
    }
}
