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

import java.util.UUID;

import static org.junit.Assert.assertNotNull;

/**
 * SSH 连接配置 DAO 插入测试；启动 Spring 环境，依赖 MySQL（需先执行 docs/dev-ops/mysql/sql/ssh-server.sql 建表）。
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

        // 1. 插入基础配置
        SshConnectionPO connection = SshConnectionPO.builder()
                .connectionId(connectionId)
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

        // 2. 插入高级配置（关联同一 connectionId）
        SshConnectionConfigPO config = SshConnectionConfigPO.builder()
                .connectionId(connectionId)
                .connectTimeout(5000)
                .keepaliveInterval(30000)
                .startupCommand("cd /root && ls")
                .strictHostKeyCheck(0)
                .knownHosts("")
                .build();
        sshConnectionConfigDao.insert(config);
        log.info("插入 ssh_connection_config 成功 id={}", config.getId());

        // 3. 回查基础配置验证
        SshConnectionPO queried = sshConnectionDao.queryByConnectionId(connectionId);
        log.info("回查 ssh_connection host={} username={} authType={} createdAt={}",
                queried.getHost(), queried.getUsername(), queried.getAuthType(), queried.getCreatedAt());
        assertNotNull("回查记录不应为空", queried);
        assertNotNull("回查主键不应为空", queried.getId());
    }

}
