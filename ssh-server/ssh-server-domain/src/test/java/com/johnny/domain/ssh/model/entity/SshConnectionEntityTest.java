package com.johnny.domain.ssh.model.entity;

import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import com.johnny.types.exception.AppException;
import org.junit.Test;

import static org.junit.Assert.assertEquals;

/**
 * SSH 连接基础实体富模型校验测试。
 */
public class SshConnectionEntityTest {

    @Test
    public void create_valid_password_auth() {
        SshConnectionEntity e = SshConnectionEntity.create(
                "cid", "我的服务器", "10.0.0.1", 22,
                "root", AuthTypeEnum.PASSWORD, "pwd", null, null, "user_001");
        assertEquals("cid", e.getConnectionId());
        assertEquals("我的服务器", e.getName());
    }

    @Test
    public void create_valid_publickey_auth() {
        SshConnectionEntity e = SshConnectionEntity.create(
                "cid", "密钥机", "10.0.0.2", 2222,
                "ubuntu", AuthTypeEnum.PUBLIC_KEY, null, "-----BEGIN PRIVATE KEY-----", null, "u");
        assertEquals(AuthTypeEnum.PUBLIC_KEY, e.getAuthType());
    }

    @Test(expected = AppException.class)
    public void validate_blank_name() {
        SshConnectionEntity.create("cid", "   ", "h", 22, "u", AuthTypeEnum.PASSWORD, "p", null, null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_name_too_long() {
        SshConnectionEntity.create("cid", "a".repeat(65), "h", 22, "u", AuthTypeEnum.PASSWORD, "p", null, null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_blank_host() {
        SshConnectionEntity.create("cid", "n", "  ", 22, "u", AuthTypeEnum.PASSWORD, "p", null, null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_invalid_port_zero() {
        SshConnectionEntity.create("cid", "n", "h", 0, "u", AuthTypeEnum.PASSWORD, "p", null, null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_invalid_port_too_large() {
        SshConnectionEntity.create("cid", "n", "h", 70000, "u", AuthTypeEnum.PASSWORD, "p", null, null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_blank_username() {
        SshConnectionEntity.create("cid", "n", "h", 22, "", AuthTypeEnum.PASSWORD, "p", null, null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_null_auth_type() {
        SshConnectionEntity.create("cid", "n", "h", 22, "u", null, "p", null, null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_password_auth_missing_password() {
        SshConnectionEntity.create("cid", "n", "h", 22, "u", AuthTypeEnum.PASSWORD, "", null, null, "u");
    }

    @Test
    public void create_valid_publickey_auth_with_keyId() {
        // 新模型：公钥认证经 keyId 引用密钥实体，无内嵌私钥
        SshConnectionEntity e = SshConnectionEntity.create(
                "cid", "密钥引用机", "10.0.0.3", 22,
                "ubuntu", AuthTypeEnum.PUBLIC_KEY, null, null, "key_001", "u");
        assertEquals("key_001", e.getKeyId());
    }

    @Test(expected = AppException.class)
    public void validate_publickey_auth_missing_key() {
        SshConnectionEntity.create("cid", "n", "h", 22, "u", AuthTypeEnum.PUBLIC_KEY, null, "", null, "u");
    }
}
