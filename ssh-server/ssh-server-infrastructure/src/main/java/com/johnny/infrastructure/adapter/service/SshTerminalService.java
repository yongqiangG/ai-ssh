package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.domain.ssh.adapter.port.ITerminalSessionPort;
import com.johnny.domain.ssh.adapter.repository.ISshConnectionRepository;
import com.johnny.domain.ssh.model.aggregate.SshConnectionAggregate;
import com.johnny.domain.ssh.model.entity.TerminalSessionEntity;
import com.johnny.domain.ssh.service.ISshTerminalService;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SSH 终端领域服务实现。
 * <p>
 * 以 sessionId 索引缓存 {@link TerminalSessionEntity}（{@link ConcurrentHashMap}），
 * 后续读写经 sessionId 查找并刷新活跃时间；通道操作全部委托 {@link ITerminalSessionPort}。
 * 一个 SSH 连接同一时刻只保留最新一个终端会话：{@link #open} 会先清理同连接旧会话。
 */
@Slf4j
@Service
public class SshTerminalService implements ISshTerminalService {

    /** pty 默认尺寸（前端未上报时兜底） */
    private static final int DEFAULT_COLS = 80;
    private static final int DEFAULT_ROWS = 24;

    /** 初始输出（motd + 提示符）最长等待时间（毫秒） */
    private static final long INITIAL_OUTPUT_MAX_WAIT = 2000;
    /** 已出现输出后，连续静默该时长即认为初始输出积累完毕（毫秒） */
    private static final long INITIAL_OUTPUT_QUIET = 200;
    /** 初始输出等待的轮询间隔（毫秒） */
    private static final long INITIAL_OUTPUT_POLL = 50;

    private final ISshSessionPort sshSessionPort;
    private final ITerminalSessionPort terminalSessionPort;
    private final ISshConnectionRepository connectionRepository;

    /** sessionId -> 终端会话实体 */
    private final Map<String, TerminalSessionEntity> sessions = new ConcurrentHashMap<>();

    public SshTerminalService(ISshSessionPort sshSessionPort, ITerminalSessionPort terminalSessionPort,
                              ISshConnectionRepository connectionRepository) {
        this.sshSessionPort = sshSessionPort;
        this.terminalSessionPort = terminalSessionPort;
        this.connectionRepository = connectionRepository;
    }

    @Override
    public OpenResult open(OpenCmd cmd) {
        if (!sshSessionPort.isConnected(cmd.connectionId)) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "SSH 连接未建立，请先连接 connectionId=" + cmd.connectionId);
        }
        closeByConnectionId(cmd.connectionId);

        String sessionId = UUID.randomUUID().toString().replace("-", "");
        int cols = cmd.cols > 0 ? cmd.cols : DEFAULT_COLS;
        int rows = cmd.rows > 0 ? cmd.rows : DEFAULT_ROWS;
        terminalSessionPort.open(sessionId, cmd.connectionId, cols, rows);
        sessions.put(sessionId, TerminalSessionEntity.create(sessionId, cmd.connectionId, cmd.userId));
        log.info("终端会话已创建 sessionId={} connectionId={} userId={}", sessionId, cmd.connectionId, cmd.userId);

        OpenResult result = new OpenResult();
        result.sessionId = sessionId;
        result.initialOutput = awaitInitialOutput(sessionId);
        // 启动命令：等初始输出（提示符）稳定后写入 shell stdin，等同用户手敲——回显在终端可见，
        // 由前端轮询取走（不并入 initialOutput，避免与 motd 混排）
        runStartupCommand(sessionId, cmd.connectionId);
        return result;
    }

    /** 连接配置了 startupCommand 时，在新终端 shell 上自动执行（可见回显）；失败不影响终端打开 */
    private void runStartupCommand(String sessionId, String connectionId) {
        try {
            SshConnectionAggregate aggregate = connectionRepository.queryByConnectionId(connectionId);
            if (aggregate == null || aggregate.getConfig() == null) {
                return;
            }
            String startupCommand = aggregate.getConfig().getStartupCommand();
            if (startupCommand == null || startupCommand.isBlank()) {
                return;
            }
            terminalSessionPort.write(sessionId, startupCommand.endsWith("\n") ? startupCommand : startupCommand + "\n");
            log.info("终端启动命令已写入 sessionId={} connectionId={} cmd=[{}]", sessionId, connectionId, startupCommand);
        } catch (Exception e) {
            log.warn("终端启动命令执行失败（不影响终端打开）sessionId={} connectionId={} reason={}",
                    sessionId, connectionId, e.getMessage());
        }
    }

    /**
     * 等待 shell 初始输出（motd/欢迎信息与首个提示符）积累完毕后一次性返回：
     * 出现首段输出后连续 {@link #INITIAL_OUTPUT_QUIET} 毫秒无新增即视为稳定；
     * 整体不超过 {@link #INITIAL_OUTPUT_MAX_WAIT} 毫秒，超时按已积累内容返回。
     */
    private String awaitInitialOutput(String sessionId) {
        StringBuilder acc = new StringBuilder();
        long deadline = System.currentTimeMillis() + INITIAL_OUTPUT_MAX_WAIT;
        long lastDataAt = 0;
        while (System.currentTimeMillis() < deadline) {
            String chunk = terminalSessionPort.drain(sessionId);
            if (!chunk.isEmpty()) {
                acc.append(chunk);
                lastDataAt = System.currentTimeMillis();
            } else if (lastDataAt > 0 && System.currentTimeMillis() - lastDataAt >= INITIAL_OUTPUT_QUIET) {
                break;
            }
            try {
                Thread.sleep(INITIAL_OUTPUT_POLL);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        return acc.toString();
    }

    @Override
    public void execCommand(String sessionId, String command) {
        requireActive(sessionId).touch();
        // 整行模式：补换行触发远端执行
        terminalSessionPort.write(sessionId, command.endsWith("\n") ? command : command + "\n");
    }

    @Override
    public void write(String sessionId, String data) {
        requireActive(sessionId).touch();
        terminalSessionPort.write(sessionId, data);
    }

    @Override
    public ReadResult read(String sessionId) {
        // 仅校验存在：通道关闭后仍允许 drain 尾部输出，并以 closed 标记告知前端
        TerminalSessionEntity entity = require(sessionId);
        entity.touch();
        ReadResult result = new ReadResult();
        result.content = terminalSessionPort.drain(sessionId);
        result.closed = !terminalSessionPort.isOpen(sessionId);
        if (result.closed) {
            entity.markClosed();
        }
        return result;
    }

    @Override
    public void resize(String sessionId, int cols, int rows) {
        requireActive(sessionId).touch();
        terminalSessionPort.resize(sessionId, cols, rows);
    }

    @Override
    public void close(String sessionId) {
        TerminalSessionEntity entity = sessions.remove(sessionId);
        terminalSessionPort.close(sessionId);
        if (entity != null) {
            entity.markClosed();
            log.info("终端会话已关闭 sessionId={} connectionId={}", sessionId, entity.getConnectionId());
        }
    }

    @Override
    public String getConnectionId(String sessionId) {
        // TerminalSessionEntity 已有 connectionId 字段（open 时写入），这里只是把它暴露给工具层（Q3b）
        TerminalSessionEntity entity = sessions.get(sessionId);
        return entity == null ? null : entity.getConnectionId();
    }

    /** 清理指定连接下的全部旧终端会话（重开终端、避免通道泄漏） */
    private void closeByConnectionId(String connectionId) {
        for (TerminalSessionEntity entity : sessions.values()) {
            if (entity.getConnectionId().equals(connectionId)) {
                log.info("清理旧终端会话 sessionId={} connectionId={}", entity.getSessionId(), connectionId);
                close(entity.getSessionId());
            }
        }
    }

    /** 会话必须存在，否则抛出参数异常 */
    private TerminalSessionEntity require(String sessionId) {
        TerminalSessionEntity entity = sessions.get(sessionId);
        if (entity == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "终端会话不存在 sessionId=" + sessionId);
        }
        return entity;
    }

    /** 会话必须存在且通道仍然打开（写入/调整尺寸的前置校验） */
    private TerminalSessionEntity requireActive(String sessionId) {
        TerminalSessionEntity entity = require(sessionId);
        if (entity.isClosed() || !terminalSessionPort.isOpen(sessionId)) {
            entity.markClosed();
            throw new AppException(ResponseCode.UN_ERROR.getCode(),
                    "终端会话已断开 sessionId=" + sessionId);
        }
        return entity;
    }
}
