package com.johnny.domain.agent.service.tools;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * 确认门读写分类测试：规则通道命中面 + 双通道 OR 合成。
 */
public class CommandClassifierTest {

    @Test
    public void write_commands_match_rules() {
        String[] writes = {
                "rm /tmp/a.log",
                "mv a b",
                "cp -r src dst",
                "chmod 755 /opt/app.sh",
                "chown root:root f",
                "kill -9 1234",
                "pkill nginx",
                "systemctl restart nginx",
                "systemctl stop mysqld",
                "service nginx restart",
                "yum install -y htop",
                "apt-get remove nginx",
                "pip install requests",
                "npm install -g pm2",
                "echo hi > /etc/motd",
                "cat a >> b.txt",
                "df -h | tee /tmp/df.log",
                "sed -i 's/a/b/' conf.ini",
                "useradd deploy",
                "passwd deploy",
                "crontab -r",
                "iptables -F",
                "ufw allow 22",
                "mkdir -p /data/app",
                "touch /tmp/flag",
                "git push origin main",
                "git reset --hard HEAD~1",
                "sysctl -w vm.swappiness=10",
        };
        for (String c : writes) {
            assertTrue("应命中写规则: " + c, CommandClassifier.matchesWritePattern(c));
        }
    }

    @Test
    public void read_commands_do_not_match_rules() {
        String[] reads = {
                "ls -la /var/log",
                "cat /etc/os-release",
                "df -h",
                "free -m",
                "uptime",
                "ps aux | grep java",
                "top -bn1 | head -20",
                "netstat -tlnp",
                "ss -tlnp",
                "journalctl -u nginx -n 50",
                "systemctl status nginx",
                "docker ps",
                "kubectl get pods",
                "tail -n 100 /var/log/messages",
                "grep -rn ERROR /var/log/app.log",
                "du -sh /data",
                "git log --oneline -5",
                "git status",
                "cat /proc/loadavg && free -m",
        };
        for (String c : reads) {
            assertFalse("不应命中写规则: " + c, CommandClassifier.matchesWritePattern(c));
        }
    }

    @Test
    public void intent_write_forces_confirm_even_if_rules_miss() {
        // 规则未覆盖的写命令（如自定义脚本），靠模型自评兜住
        assertTrue(CommandClassifier.needsConfirm("/opt/scripts/rotate-and-purge.sh", "write"));
    }

    @Test
    public void rules_force_confirm_even_if_model_claims_read() {
        // 模型误报/说谎 read，规则兜住
        assertTrue(CommandClassifier.needsConfirm("rm -f /tmp/x", "read"));
    }

    @Test
    public void read_intent_and_no_rule_hit_passes() {
        assertFalse(CommandClassifier.needsConfirm("df -h", "read"));
        assertFalse(CommandClassifier.needsConfirm("df -h", null));
    }
}
