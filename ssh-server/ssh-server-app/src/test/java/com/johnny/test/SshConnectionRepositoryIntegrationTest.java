package com.johnny.test;

import com.johnny.domain.ssh.adapter.repository.ISshConnectionRepository;
import com.johnny.domain.ssh.model.aggregate.SshConnectionAggregate;
import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import com.johnny.infrastructure.dao.ISshConnectionDao;
import com.johnny.infrastructure.dao.po.SshConnectionPO;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.junit4.SpringRunner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * 仓储加密落库端到端验证；启动 Spring 环境连 MySQL（依赖 AES-256-GCM 加密配置）。
 */
@RunWith(SpringRunner.class)
@SpringBootTest
public class SshConnectionRepositoryIntegrationTest {

    @Autowired
    private ISshConnectionRepository repository;

    @Autowired
    private ISshConnectionDao connectionDao;

    @Test
    public void save_encrypts_and_query_decrypts() {
        String plainPassword = "super-secret-pwd-123";
        SshConnectionAggregate agg = SshConnectionAggregate.create(
                "加密测试连接", "10.0.0.9", 22, "root",
                AuthTypeEnum.PASSWORD, plainPassword, null, null, "user_encrypt",
                null, null, null, false, null, false);

        repository.save(agg);
        String cid = agg.getConnectionId();

        // 落库的 password 应为密文（v1: 前缀），且不等于明文
        SshConnectionPO po = connectionDao.queryByConnectionId(cid);
        assertNotNull(po);
        assertTrue("落库密码应为 v1: 前缀的密文", po.getPassword().startsWith("v1:"));
        assertNotEquals("密文不应等于明文", plainPassword, po.getPassword());

        // 回读经仓储解密，应还原明文
        SshConnectionAggregate found = repository.queryByConnectionId(cid);
        assertNotNull(found);
        assertEquals(plainPassword, found.getConnection().getPassword());
        assertEquals("加密测试连接", found.getConnection().getName());
        assertEquals(cid, found.getConfig().getConnectionId());

        // 清理
        repository.remove(cid);
        assertNull(repository.queryByConnectionId(cid));
    }

    @Test
    public void save_same_password_produces_different_ciphertext() {
        SshConnectionAggregate a = SshConnectionAggregate.create(
                "连接A", "10.0.0.1", 22, "root",
                AuthTypeEnum.PASSWORD, "same-pwd", null, null, "u",
                null, null, null, false, null, false);
        SshConnectionAggregate b = SshConnectionAggregate.create(
                "连接B", "10.0.0.2", 22, "root",
                AuthTypeEnum.PASSWORD, "same-pwd", null, null, "u",
                null, null, null, false, null, false);
        repository.save(a);
        repository.save(b);

        SshConnectionPO pa = connectionDao.queryByConnectionId(a.getConnectionId());
        SshConnectionPO pb = connectionDao.queryByConnectionId(b.getConnectionId());
        assertNotEquals("相同明文落库密文应不同（随机IV）", pa.getPassword(), pb.getPassword());

        repository.remove(a.getConnectionId());
        repository.remove(b.getConnectionId());
    }
}
