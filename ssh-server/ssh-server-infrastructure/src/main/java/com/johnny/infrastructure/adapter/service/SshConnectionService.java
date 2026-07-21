package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.ssh.adapter.port.ConnectParams;
import com.johnny.domain.ssh.adapter.port.ConnectResult;
import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.domain.ssh.adapter.repository.ISshConnectionRepository;
import com.johnny.domain.ssh.adapter.repository.ISshKeyRepository;
import com.johnny.domain.ssh.model.aggregate.SshConnectionAggregate;
import com.johnny.domain.ssh.model.entity.SshConnectionConfigEntity;
import com.johnny.domain.ssh.model.entity.SshConnectionEntity;
import com.johnny.domain.ssh.model.entity.SshKeyEntity;
import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import com.johnny.domain.ssh.service.ISshConnectionService;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * SSH 连接领域服务实现。
 * <p>
 * 编排校验、聚合根构建、持久化与会话连接管理（连接管理委托 {@link ISshSessionPort}）。
 */
@Service
public class SshConnectionService implements ISshConnectionService {

    private final ISshConnectionRepository repository;
    private final ISshSessionPort sessionPort;
    private final ISshKeyRepository keyRepository;

    public SshConnectionService(ISshConnectionRepository repository, ISshSessionPort sessionPort,
                                ISshKeyRepository keyRepository) {
        this.repository = repository;
        this.sessionPort = sessionPort;
        this.keyRepository = keyRepository;
    }

    @Override
    public String create(CreateCmd cmd) {
        SshConnectionAggregate aggregate = SshConnectionAggregate.create(
                cmd.name, cmd.host, cmd.port, cmd.username, cmd.authType,
                cmd.password, null, cmd.keyId, cmd.userId,
                cmd.connectTimeout, cmd.keepaliveInterval, cmd.startupCommand,
                cmd.strictHostKeyCheck, cmd.knownHosts, cmd.compression);
        repository.save(aggregate);
        return aggregate.getConnectionId();
    }

    @Override
    public void update(String connectionId, UpdateCmd cmd) {
        SshConnectionAggregate old = repository.queryByConnectionId(connectionId);
        if (old == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接不存在: " + connectionId);
        }
        SshConnectionEntity oldConn = old.getConnection();
        SshConnectionConfigEntity oldCfg = old.getConfig();

        // 合并：cmd 非 null 用 cmd，否则沿用旧值——password/keyId 为 null 即「不修改」，
        // authType 切换时对侧凭据保留在库（用户切回免重填）
        String name = cmd.name != null ? cmd.name : oldConn.getName();
        String host = cmd.host != null ? cmd.host : oldConn.getHost();
        int port = cmd.port != null ? cmd.port : oldConn.getPort();
        String username = cmd.username != null ? cmd.username : oldConn.getUsername();
        AuthTypeEnum authType = cmd.authType != null ? cmd.authType : oldConn.getAuthType();
        String password = cmd.password != null ? cmd.password : oldConn.getPassword();
        String keyId = cmd.keyId != null ? cmd.keyId : oldConn.getKeyId();
        // privateKey 不再接受外部写入（密钥统一走 ssh_key 实体）；沿用旧值仅为迁移前数据的读兼容
        String privateKey = oldConn.getPrivateKey();

        // 重新校验后还原基础实体（保持原 connectionId）
        SshConnectionEntity.validate(name, host, port, username, authType, password, privateKey, keyId);
        SshConnectionEntity conn = SshConnectionEntity.restore(
                oldConn.getConnectionId(), name, host, port, username, authType,
                password, privateKey, keyId, oldConn.getUserId());

        Integer connectTimeout = cmd.connectTimeout != null ? cmd.connectTimeout : oldCfg.getConnectTimeout();
        Integer keepaliveInterval = cmd.keepaliveInterval != null ? cmd.keepaliveInterval : oldCfg.getKeepaliveInterval();
        String startupCommand = cmd.startupCommand != null ? cmd.startupCommand : oldCfg.getStartupCommand();
        String knownHosts = cmd.knownHosts != null ? cmd.knownHosts : oldCfg.getKnownHosts();
        boolean strictHostKeyCheck = cmd.strictHostKeyCheck != null ? cmd.strictHostKeyCheck : oldCfg.isStrictHostKeyCheck();
        boolean compression = cmd.compression != null ? cmd.compression : oldCfg.isCompression();

        SshConnectionConfigEntity cfg = SshConnectionConfigEntity.create(
                oldConn.getConnectionId(), connectTimeout, keepaliveInterval, startupCommand,
                strictHostKeyCheck, knownHosts, compression);
        cfg.validate();
        cfg.applyDefaults();

        repository.update(SshConnectionAggregate.restore(conn, cfg));
    }

    @Override
    public SshConnectionAggregate query(String connectionId) {
        return repository.queryByConnectionId(connectionId);
    }

    @Override
    public List<SshConnectionEntity> list(String userId) {
        return repository.queryByUserId(userId);
    }

    @Override
    public void remove(String connectionId) {
        sessionPort.disconnect(connectionId);
        repository.remove(connectionId);
    }

    @Override
    public ConnectResult connect(String connectionId) {
        SshConnectionAggregate aggregate = repository.queryByConnectionId(connectionId);
        if (aggregate == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接不存在: " + connectionId);
        }
        SshConnectionEntity conn = aggregate.getConnection();
        SshConnectionConfigEntity cfg = aggregate.getConfig();
        // 连接状态是运行时事实（sessionPort 内存会话），不落库
        ConnectParams params = new ConnectParams();
        params.host = conn.getHost();
        params.port = conn.getPort();
        params.username = conn.getUsername();
        params.password = conn.getPassword();
        // 凭据来源：keyId 引用密钥实体（新模型）优先；内嵌 privateKey 仅迁移前数据兜底
        if (StringUtils.isNotBlank(conn.getKeyId())) {
            SshKeyEntity key = keyRepository.queryByKeyId(conn.getKeyId());
            if (key == null) {
                throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                        "连接引用的密钥不存在 keyId=" + conn.getKeyId());
            }
            params.privateKey = key.getPrivateKey();
            params.passphrase = key.getPassphrase();
        } else {
            params.privateKey = conn.getPrivateKey();
        }
        if (cfg != null) {
            params.connectTimeout = cfg.getConnectTimeout();
            params.keepaliveInterval = cfg.getKeepaliveInterval();
            params.compression = cfg.isCompression();
            params.strictHostKeyCheck = cfg.isStrictHostKeyCheck();
            params.knownHosts = cfg.getKnownHosts();
        }
        return sessionPort.connect(conn.getConnectionId(), params);
    }

    @Override
    public void acceptHostKey(String connectionId, String knownHostLine) {
        if (StringUtils.isBlank(knownHostLine)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "known_hosts 行不能为空");
        }
        String[] parts = knownHostLine.trim().split("\\s+");
        if (parts.length < 3) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "known_hosts 行格式非法（应为 host keytype base64key）");
        }
        SshConnectionAggregate aggregate = repository.queryByConnectionId(connectionId);
        if (aggregate == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接不存在: " + connectionId);
        }
        SshConnectionConfigEntity cfg = aggregate.getConfig();
        String host = parts[0];
        String type = parts[1];
        // 合并：同 host+type 的旧记录被新指纹替换（CHANGED 场景的「信任新指纹」）
        StringBuilder merged = new StringBuilder();
        String existing = cfg == null ? "" : cfg.getKnownHosts();
        if (StringUtils.isNotBlank(existing)) {
            for (String line : existing.split("\\r?\\n")) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                String[] p = trimmed.split("\\s+");
                boolean sameEntry = p.length >= 2 && p[0].equals(host) && p[1].equals(type);
                if (!sameEntry) {
                    merged.append(trimmed).append('\n');
                }
            }
        }
        merged.append(knownHostLine.trim()).append('\n');

        SshConnectionConfigEntity newCfg = SshConnectionConfigEntity.create(
                connectionId,
                cfg == null ? null : cfg.getConnectTimeout(),
                cfg == null ? null : cfg.getKeepaliveInterval(),
                cfg == null ? "" : cfg.getStartupCommand(),
                cfg == null || cfg.isStrictHostKeyCheck(),
                merged.toString(),
                cfg != null && cfg.isCompression());
        newCfg.validate();
        newCfg.applyDefaults();
        repository.update(SshConnectionAggregate.restore(aggregate.getConnection(), newCfg));
    }

    @Override
    public void disconnect(String connectionId) {
        sessionPort.disconnect(connectionId);
    }

    @Override
    public boolean isConnected(String connectionId) {
        return sessionPort.isConnected(connectionId);
    }

    @Override
    public String exec(String connectionId, String command) {
        SshConnectionAggregate aggregate = repository.queryByConnectionId(connectionId);
        if (aggregate == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接不存在: " + connectionId);
        }
        return sessionPort.exec(connectionId, command);
    }
}
