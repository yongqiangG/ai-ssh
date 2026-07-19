package com.johnny.domain.ssh.model.aggregate;

import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

/**
 * SSH 连接聚合根创建编排测试。
 */
public class SshConnectionAggregateTest {

    @Test
    public void create_generates_connectionId_and_applies_defaults() {
        SshConnectionAggregate agg = SshConnectionAggregate.create(
                "我的连接", "10.0.0.1", 22, "root",
                AuthTypeEnum.PASSWORD, "pwd", null, "user_001",
                null, null, null, false, null, false);

        String cid = agg.getConnectionId();
        assertNotNull(cid);
        assertEquals(32, cid.length()); // UUID 去掉横线后 32 个十六进制字符
        assertEquals(cid, agg.getConnection().getConnectionId());
        assertEquals(cid, agg.getConfig().getConnectionId());
        // 默认值已填充
        assertEquals(Integer.valueOf(5000), agg.getConfig().getConnectTimeout());
        assertEquals(Integer.valueOf(30000), agg.getConfig().getKeepaliveInterval());
        assertEquals("", agg.getConfig().getKnownHosts());
    }

    @Test
    public void create_uses_user_config_when_provided() {
        SshConnectionAggregate agg = SshConnectionAggregate.create(
                "我的连接", "10.0.0.1", 22, "root",
                AuthTypeEnum.PASSWORD, "pwd", null, "user_001",
                8000, 60000, "ls", true, "known", true);
        assertEquals(Integer.valueOf(8000), agg.getConfig().getConnectTimeout());
        assertEquals(true, agg.getConfig().isStrictHostKeyCheck());
        assertEquals(true, agg.getConfig().isCompression());
    }
}
