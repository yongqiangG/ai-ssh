package com.johnny.infrastructure.migration;

import com.johnny.infrastructure.dao.ISshConnectionConfigDao;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * 存量数据迁移：strictHostKeyCheck 安全默认翻转补齐。
 * <p>
 * 迭代 A（7de338b）把 DDL 列默认值从 0 翻为 1，但没有 UPDATE 存量数据——
 * 此前建的连接仍为 0，静默跳过 host key 校验。这里启动时统一翻为 1，
 * 老连接下次连接将重新走 TOFU（knownHosts 为空，弹一次确认卡即可）。
 * <p>
 * 幂等：只更新 strict_host_key_check=0 的行，迁移后不再命中。
 */
@Slf4j
@Component
public class StrictHostKeyMigrationRunner implements ApplicationRunner {

    private final ISshConnectionConfigDao configDao;

    public StrictHostKeyMigrationRunner(ISshConnectionConfigDao configDao) {
        this.configDao = configDao;
    }

    @Override
    public void run(ApplicationArguments args) {
        int updated = configDao.enableStrictHostKeyCheckForLegacy();
        if (updated > 0) {
            log.info("存量连接 strictHostKeyCheck 已按安全默认补齐为开启，共 {} 条（下次连接重新 TOFU）", updated);
        }
    }
}
