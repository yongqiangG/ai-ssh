package com.johnny.test;

import com.johnny.infrastructure.dao.ISshConnectionConfigDao;
import com.johnny.infrastructure.dao.ISshConnectionDao;
import com.johnny.infrastructure.dao.po.SshConnectionConfigPO;
import com.johnny.infrastructure.dao.po.SshConnectionPO;
import lombok.extern.slf4j.Slf4j;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.junit4.SpringRunner;

import java.util.List;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * SSH 连接配置 DAO 测试；启动 Spring 环境，依赖 MySQL（需先执行 docs/dev-ops/mysql/sql/ssh-server.sql 建表）。
 */
@Slf4j
@RunWith(SpringRunner.class)
@SpringBootTest
public class SshConnectionDaoTest {

    @Autowired
    private ISshConnectionDao sshConnectionDao;

    @Autowired
    private ISshConnectionConfigDao sshConnectionConfigDao;

    @Test
    public void test_insert_ssh_connection_and_config() {
        String connectionId = UUID.randomUUID().toString();

        SshConnectionPO connection = SshConnectionPO.builder()
                .connectionId(connectionId)
                .name("测试连接")
                .host("10.10.10.10")
                .port(22)
                .username("root")
                .authType("PASSWORD")
                .password("root")
                .status(0)
                .userId("user_001")
                .build();
        sshConnectionDao.insert(connection);
        log.info("插入 ssh_connection 成功 id={} connectionId={}", connection.getId(), connectionId);

        SshConnectionConfigPO config = SshConnectionConfigPO.builder()
                .connectionId(connectionId)
                .connectTimeout(5000)
                .keepaliveInterval(30000)
                .startupCommand("cd /root && ls")
                .strictHostKeyCheck(0)
                .compression(0)
                .knownHosts("")
                .build();
        sshConnectionConfigDao.insert(config);
        log.info("插入 ssh_connection_config 成功 id={}", config.getId());

        SshConnectionPO queried = sshConnectionDao.queryByConnectionId(connectionId);
        log.info("回查 ssh_connection host={} username={} authType={} createdAt={}",
                queried.getHost(), queried.getUsername(), queried.getAuthType(), queried.getCreatedAt());
        assertNotNull("回查记录不应为空", queried);
        assertNotNull("回查主键不应为空", queried.getId());
    }

    /**
     * 覆盖两表的增删改查全流程：insert→query→update→query→(逻辑/物理)delete→query。
     */
    @Test
    public void test_crud() {
        String connectionId = UUID.randomUUID().toString();
        String userId = "user_crud_" + System.nanoTime();

        // ---------- ssh_connection ----------
        // 增
        SshConnectionPO conn = SshConnectionPO.builder()
                .connectionId(connectionId)
                .name("crud连接")
                .host("10.10.10.10")
                .port(22)
                .username("root")
                .authType("PASSWORD")
                .password("root")
                .status(0)
                .userId(userId)
                .build();
        sshConnectionDao.insert(conn);

        // 查
        SshConnectionPO found = sshConnectionDao.queryByConnectionId(connectionId);
        assertNotNull("插入后应能查到", found);
        assertEquals("root", found.getUsername());

        // 改
        found.setUsername("admin");
        found.setStatus(1);
        assertEquals("update 应影响 1 行", 1, sshConnectionDao.update(found));
        SshConnectionPO afterUpdate = sshConnectionDao.queryByConnectionId(connectionId);
        assertEquals("admin", afterUpdate.getUsername());
        assertEquals(Integer.valueOf(1), afterUpdate.getStatus());

        // 列表查（按用户）
        List<SshConnectionPO> list = sshConnectionDao.queryByUserId(userId);
        assertTrue("按用户查询至少 1 条", list.size() >= 1);

        // 逻辑删
        assertEquals("softDelete 应影响 1 行", 1, sshConnectionDao.softDeleteByConnectionId(connectionId));
        assertNull("逻辑删除后按 connectionId 查应返回 null", sshConnectionDao.queryByConnectionId(connectionId));

        // ---------- ssh_connection_config ----------
        SshConnectionConfigPO cfg = SshConnectionConfigPO.builder()
                .connectionId(connectionId)
                .connectTimeout(3000)
                .keepaliveInterval(10000)
                .startupCommand("ls")
                .strictHostKeyCheck(0)
                .compression(0)
                .knownHosts("")
                .build();
        sshConnectionConfigDao.insert(cfg);

        cfg.setConnectTimeout(8000);
        cfg.setStartupCommand("pwd");
        assertEquals("config update 应影响 1 行", 1, sshConnectionConfigDao.update(cfg));
        SshConnectionConfigPO cfgFound = sshConnectionConfigDao.queryByConnectionId(connectionId);
        assertEquals(Integer.valueOf(8000), cfgFound.getConnectTimeout());
        assertEquals("pwd", cfgFound.getStartupCommand());

        assertEquals("config delete 应影响 1 行", 1, sshConnectionConfigDao.deleteByConnectionId(connectionId));
        assertNull("config 删除后查询应返回 null", sshConnectionConfigDao.queryByConnectionId(connectionId));

        log.info("CRUD 全流程验证通过 connectionId={}", connectionId);
    }

}
