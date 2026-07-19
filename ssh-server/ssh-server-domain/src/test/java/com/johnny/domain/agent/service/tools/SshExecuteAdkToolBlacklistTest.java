package com.johnny.domain.agent.service.tools;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * 危险命令黑名单规则测试（Q12）。
 * <p>重点覆盖 review 发现的绕过变体：{@code rm -fr /}（f 在 r 前）。
 */
public class SshExecuteAdkToolBlacklistTest {

    @Test
    public void blocks_rm_rf_variants() {
        assertTrue(SshExecuteAdkTool.isBlocked("rm -rf /"));
        assertTrue(SshExecuteAdkTool.isBlocked("rm -fr /"));
        assertTrue(SshExecuteAdkTool.isBlocked("rm -rf /etc"));
        assertTrue(SshExecuteAdkTool.isBlocked("rm -fr ~"));
        assertTrue(SshExecuteAdkTool.isBlocked("sudo rm -rf /"));
        assertTrue(SshExecuteAdkTool.isBlocked("rm --force /"));
        assertTrue(SshExecuteAdkTool.isBlocked("rm -rf $HOME"));
        assertTrue(SshExecuteAdkTool.isBlocked("rm -rf *"));
    }

    @Test
    public void blocks_other_dangerous_commands() {
        assertTrue(SshExecuteAdkTool.isBlocked("mkfs.ext4 /dev/sda1"));
        assertTrue(SshExecuteAdkTool.isBlocked("dd if=/dev/zero of=/dev/sda"));
        assertTrue(SshExecuteAdkTool.isBlocked("reboot"));
        assertTrue(SshExecuteAdkTool.isBlocked("shutdown -h now"));
        assertTrue(SshExecuteAdkTool.isBlocked(":(){ :|:& };:"));
        assertTrue(SshExecuteAdkTool.isBlocked("chmod -R 000 /"));
    }

    @Test
    public void allows_normal_commands() {
        assertFalse(SshExecuteAdkTool.isBlocked("ls -la"));
        assertFalse(SshExecuteAdkTool.isBlocked("rm -rf ./build"));      // 相对路径不拦
        assertFalse(SshExecuteAdkTool.isBlocked("rm temp.txt"));
        assertFalse(SshExecuteAdkTool.isBlocked("cat /etc/os-release"));
        assertFalse(SshExecuteAdkTool.isBlocked("free -h"));
        assertFalse(SshExecuteAdkTool.isBlocked("df -h /"));
        assertFalse(SshExecuteAdkTool.isBlocked(null));
    }
}
