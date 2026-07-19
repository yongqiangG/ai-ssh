package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.domain.ssh.adapter.repository.ISshConnectionRepository;
import com.johnny.domain.ssh.model.aggregate.SshConnectionAggregate;
import com.johnny.domain.ssh.model.entity.SshConnectionConfigEntity;
import com.johnny.domain.ssh.model.entity.SshConnectionEntity;
import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import com.johnny.domain.ssh.service.ISshConnectionService;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
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

    public SshConnectionService(ISshConnectionRepository repository, ISshSessionPort sessionPort) {
        this.repository = repository;
        this.sessionPort = sessionPort;
    }

    @Override
    public String create(CreateCmd cmd) {
        SshConnectionAggregate aggregate = SshConnectionAggregate.create(
                cmd.name, cmd.host, cmd.port, cmd.username, cmd.authType,
                cmd.password, cmd.privateKey, cmd.userId,
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

        // 合并：cmd 非 null 用 cmd，否则沿用旧值（password/privateKey 为 null 时保留旧明文）
        String name = cmd.name != null ? cmd.name : oldConn.getName();
        String host = cmd.host != null ? cmd.host : oldConn.getHost();
        int port = cmd.port != null ? cmd.port : oldConn.getPort();
        String username = cmd.username != null ? cmd.username : oldConn.getUsername();
        AuthTypeEnum authType = cmd.authType != null ? cmd.authType : oldConn.getAuthType();
        String password = cmd.password != null ? cmd.password : oldConn.getPassword();
        String privateKey = cmd.privateKey != null ? cmd.privateKey : oldConn.getPrivateKey();

        // 重新校验后还原基础实体（保持原 connectionId）
        SshConnectionEntity.validate(name, host, port, username, authType, password, privateKey);
        SshConnectionEntity conn = SshConnectionEntity.restore(
                oldConn.getConnectionId(), name, host, port, username, authType,
                password, privateKey, oldConn.getUserId());

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
    public boolean connect(String connectionId) {
        SshConnectionAggregate aggregate = repository.queryByConnectionId(connectionId);
        if (aggregate == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接不存在: " + connectionId);
        }
        SshConnectionEntity conn = aggregate.getConnection();
        // 连接状态是运行时事实（sessionPort 内存会话），不落库
        return sessionPort.connect(
                conn.getConnectionId(), conn.getHost(), conn.getPort(),
                conn.getUsername(), conn.getPassword(), conn.getPrivateKey());
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
