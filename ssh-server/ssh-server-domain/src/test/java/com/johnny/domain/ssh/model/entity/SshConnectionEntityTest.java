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
                "root", AuthTypeEnum.PASSWORD, "pwd", null, "user_001");
        assertEquals("cid", e.getConnectionId());
        assertEquals("我的服务器", e.getName());
    }

    @Test
    public void create_valid_publickey_auth() {
        SshConnectionEntity e = SshConnectionEntity.create(
                "cid", "密钥机", "10.0.0.2", 2222,
                "ubuntu", AuthTypeEnum.PUBLIC_KEY, null, "-----BEGIN PRIVATE KEY-----", "u");
        assertEquals(AuthTypeEnum.PUBLIC_KEY, e.getAuthType());
    }

    @Test(expected = AppException.class)
    public void validate_blank_name() {
        SshConnectionEntity.create("cid", "   ", "h", 22, "u", AuthTypeEnum.PASSWORD, "p", null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_name_too_long() {
        SshConnectionEntity.create("cid", "a".repeat(65), "h", 22, "u", AuthTypeEnum.PASSWORD, "p", null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_blank_host() {
        SshConnectionEntity.create("cid", "n", "  ", 22, "u", AuthTypeEnum.PASSWORD, "p", null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_invalid_port_zero() {
        SshConnectionEntity.create("cid", "n", "h", 0, "u", AuthTypeEnum.PASSWORD, "p", null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_invalid_port_too_large() {
        SshConnectionEntity.create("cid", "n", "h", 70000, "u", AuthTypeEnum.PASSWORD, "p", null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_blank_username() {
        SshConnectionEntity.create("cid", "n", "h", 22, "", AuthTypeEnum.PASSWORD, "p", null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_null_auth_type() {
        SshConnectionEntity.create("cid", "n", "h", 22, "u", null, "p", null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_password_auth_missing_password() {
        SshConnectionEntity.create("cid", "n", "h", 22, "u", AuthTypeEnum.PASSWORD, "", null, "u");
    }

    @Test(expected = AppException.class)
    public void validate_publickey_auth_missing_key() {
        SshConnectionEntity.create("cid", "n", "h", 22, "u", AuthTypeEnum.PUBLIC_KEY, null, "", "u");
    }
}
