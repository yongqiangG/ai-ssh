package com.johnny.domain.ssh.model.entity;

import com.johnny.types.exception.AppException;
import org.junit.Test;

import static org.junit.Assert.assertEquals;

/**
 * SSH 高级配置实体默认值填充与校验测试。
 */
public class SshConnectionConfigEntityTest {

    @Test
    public void applyDefaults_fills_when_user_not_specified() {
        SshConnectionConfigEntity c = SshConnectionConfigEntity.create(
                "cid", null, null, null, false, null, false);
        c.applyDefaults();
        assertEquals(Integer.valueOf(SshConnectionConfigEntity.DEFAULT_CONNECT_TIMEOUT), c.getConnectTimeout());
        assertEquals(Integer.valueOf(SshConnectionConfigEntity.DEFAULT_KEEPALIVE_INTERVAL), c.getKeepaliveInterval());
        assertEquals("", c.getStartupCommand());
        assertEquals("", c.getKnownHosts());
        assertEquals(false, c.isCompression());
        assertEquals(false, c.isStrictHostKeyCheck());
    }

    @Test
    public void applyDefaults_keeps_user_specified() {
        SshConnectionConfigEntity c = SshConnectionConfigEntity.create(
                "cid", 8000, 60000, "ls -la", true, "known", true);
        c.applyDefaults();
        assertEquals(Integer.valueOf(8000), c.getConnectTimeout());
        assertEquals(Integer.valueOf(60000), c.getKeepaliveInterval());
        assertEquals("ls -la", c.getStartupCommand());
        assertEquals("known", c.getKnownHosts());
        assertEquals(true, c.isStrictHostKeyCheck());
        assertEquals(true, c.isCompression());
    }

    @Test
    public void applyDefaults_replaces_non_positive() {
        SshConnectionConfigEntity c = SshConnectionConfigEntity.create(
                "cid", 0, -1, null, false, null, false);
        c.applyDefaults();
        assertEquals(Integer.valueOf(SshConnectionConfigEntity.DEFAULT_CONNECT_TIMEOUT), c.getConnectTimeout());
        assertEquals(Integer.valueOf(SshConnectionConfigEntity.DEFAULT_KEEPALIVE_INTERVAL), c.getKeepaliveInterval());
    }

    @Test(expected = AppException.class)
    public void validate_negative_timeout() {
        SshConnectionConfigEntity.create("cid", -100, 1000, null, false, null, false).validate();
    }

    @Test(expected = AppException.class)
    public void validate_negative_keepalive() {
        SshConnectionConfigEntity.create("cid", 1000, -5, null, false, null, false).validate();
    }
}
