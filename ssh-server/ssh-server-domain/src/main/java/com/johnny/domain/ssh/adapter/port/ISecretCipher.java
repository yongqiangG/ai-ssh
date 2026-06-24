package com.johnny.domain.ssh.adapter.port;

/**
 * 密钥加解密端口（依赖倒置）。
 * <p>
 * 定义在领域层，由基础设施层实现（AES-256-GCM，随机初始化向量）。
 * 用于敏感字段（密码、私钥）落库前加密、读取时解密；领域内始终保持明文。
 */
public interface ISecretCipher {

    /**
     * 加密明文。每次加密使用随机 IV，相同明文每次结果不同。null/空串原样返回。
     *
     * @param plaintext 明文
     * @return 密文
     */
    String encrypt(String plaintext);

    /**
     * 解密密文。null/空串原样返回；非法密文抛运行时异常。
     *
     * @param ciphertext 密文
     * @return 明文
     */
    String decrypt(String ciphertext);
}
