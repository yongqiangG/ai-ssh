package com.johnny.trigger.http;

import com.johnny.api.dto.SshConnectionCreateRequestDTO;
import com.johnny.api.dto.SshConnectionResponseDTO;
import com.johnny.api.dto.SshConnectionUpdateRequestDTO;
import com.johnny.api.dto.SshExecRequestDTO;
import com.johnny.api.response.Response;
import com.johnny.domain.ssh.model.aggregate.SshConnectionAggregate;
import com.johnny.domain.ssh.model.entity.SshConnectionConfigEntity;
import com.johnny.domain.ssh.model.entity.SshConnectionEntity;
import com.johnny.domain.ssh.model.valobj.AuthTypeEnum;
import com.johnny.domain.ssh.service.ISshConnectionService;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.stream.Collectors;

/**
 * SSH 连接管理 HTTP 接口。
 * <p>
 * 将领域服务 {@link ISshConnectionService} 封装为 REST，提供连接的增删改查与会话连接管理。
 * DTO↔领域命令/实体的转换在本层完成，不污染领域。userId 由请求头 {@code X-User-Id} 注入。
 */
@RestController
@RequestMapping("/api/ssh/connections")
public class SshConnectionController {

    private final ISshConnectionService sshConnectionService;

    public SshConnectionController(ISshConnectionService sshConnectionService) {
        this.sshConnectionService = sshConnectionService;
    }

    /** 创建连接，返回 connectionId */
    @PostMapping
    public Response<String> create(@RequestBody SshConnectionCreateRequestDTO dto,
                                   @RequestHeader(value = "X-User-Id", required = false, defaultValue = "default") String userId) {
        ISshConnectionService.CreateCmd cmd = new ISshConnectionService.CreateCmd();
        cmd.userId = userId;
        cmd.name = dto.getName();
        cmd.host = dto.getHost();
        cmd.port = dto.getPort();
        cmd.username = dto.getUsername();
        cmd.authType = AuthTypeEnum.of(dto.getAuthType());
        cmd.password = dto.getPassword();
        cmd.keyId = dto.getKeyId();
        cmd.connectTimeout = dto.getConnectTimeout();
        cmd.keepaliveInterval = dto.getKeepaliveInterval();
        cmd.startupCommand = dto.getStartupCommand();
        cmd.knownHosts = dto.getKnownHosts();
        cmd.strictHostKeyCheck = dto.isStrictHostKeyCheck();
        cmd.compression = dto.isCompression();
        String connectionId = sshConnectionService.create(cmd);
        return Response.success(connectionId);
    }

    /** 更新连接（DTO 中 null 字段表示不修改） */
    @PutMapping("/{connectionId}")
    public Response<Void> update(@PathVariable("connectionId") String connectionId,
                                 @RequestBody SshConnectionUpdateRequestDTO dto) {
        ISshConnectionService.UpdateCmd cmd = new ISshConnectionService.UpdateCmd();
        cmd.name = dto.getName();
        cmd.host = dto.getHost();
        cmd.port = dto.getPort();
        cmd.username = dto.getUsername();
        cmd.authType = dto.getAuthType() == null ? null : AuthTypeEnum.of(dto.getAuthType());
        cmd.password = dto.getPassword();
        cmd.keyId = dto.getKeyId();
        cmd.connectTimeout = dto.getConnectTimeout();
        cmd.keepaliveInterval = dto.getKeepaliveInterval();
        cmd.startupCommand = dto.getStartupCommand();
        cmd.knownHosts = dto.getKnownHosts();
        cmd.strictHostKeyCheck = dto.getStrictHostKeyCheck();
        cmd.compression = dto.getCompression();
        sshConnectionService.update(connectionId, cmd);
        return Response.success(null);
    }

    /** 查询单个连接聚合根 */
    @GetMapping("/{connectionId}")
    public Response<SshConnectionResponseDTO> get(@PathVariable("connectionId") String connectionId) {
        SshConnectionAggregate aggregate = sshConnectionService.query(connectionId);
        if (aggregate == null) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "连接不存在: " + connectionId);
        }
        return Response.success(toResponseDTO(aggregate));
    }

    /** 列出当前用户全部连接 */
    @GetMapping
    public Response<List<SshConnectionResponseDTO>> list(
            @RequestHeader(value = "X-User-Id", required = false, defaultValue = "default") String userId) {
        List<SshConnectionResponseDTO> list = sshConnectionService.list(userId).stream()
                .map(this::toResponseDTO)
                .collect(Collectors.toList());
        return Response.success(list);
    }

    /** 删除连接 */
    @DeleteMapping("/{connectionId}")
    public Response<Void> remove(@PathVariable("connectionId") String connectionId) {
        sshConnectionService.remove(connectionId);
        return Response.success(null);
    }

    /** 建立连接 */
    @PostMapping("/{connectionId}/connect")
    public Response<Boolean> connect(@PathVariable("connectionId") String connectionId) {
        return Response.success(sshConnectionService.connect(connectionId));
    }

    /** 断开连接 */
    @PostMapping("/{connectionId}/disconnect")
    public Response<Void> disconnect(@PathVariable("connectionId") String connectionId) {
        sshConnectionService.disconnect(connectionId);
        return Response.success(null);
    }

    /** 查询实时连接状态（是否已连接） */
    @GetMapping("/{connectionId}/status")
    public Response<Boolean> status(@PathVariable("connectionId") String connectionId) {
        return Response.success(sshConnectionService.isConnected(connectionId));
    }

    /** 在已建立的连接上执行单条命令，返回标准输出 */
    @PostMapping("/{connectionId}/exec")
    public Response<String> exec(@PathVariable("connectionId") String connectionId,
                                 @RequestBody SshExecRequestDTO req) {
        return Response.success(sshConnectionService.exec(connectionId, req.getCommand()));
    }

    /** 聚合根 → 响应 DTO（基础 + 高级配置齐全） */
    private SshConnectionResponseDTO toResponseDTO(SshConnectionAggregate aggregate) {
        return toResponseDTO(aggregate.getConnection(), aggregate.getConfig());
    }

    /** 基础实体 → 响应 DTO（列表场景，高级配置字段缺省） */
    private SshConnectionResponseDTO toResponseDTO(SshConnectionEntity conn) {
        return toResponseDTO(conn, null);
    }

    private SshConnectionResponseDTO toResponseDTO(SshConnectionEntity conn, SshConnectionConfigEntity cfg) {
        SshConnectionResponseDTO dto = new SshConnectionResponseDTO();
        dto.setConnectionId(conn.getConnectionId());
        dto.setName(conn.getName());
        dto.setHost(conn.getHost());
        dto.setPort(conn.getPort());
        dto.setUsername(conn.getUsername());
        dto.setAuthType(conn.getAuthType().getCode());
        // 凭据只写不回显：密码/私钥永不回传；回填依赖布尔与 keyId 引用（apiKeyConfigured 同款模式）
        dto.setPasswordConfigured(conn.getPassword() != null && !conn.getPassword().isEmpty());
        dto.setKeyId(conn.getKeyId());
        // 状态不落库：以内存会话为准实时计算（0 未连接 / 1 已连接，编码与前端约定不变）
        dto.setStatus(sshConnectionService.isConnected(conn.getConnectionId()) ? 1 : 0);
        dto.setUserId(conn.getUserId());
        if (cfg != null) {
            dto.setConnectTimeout(cfg.getConnectTimeout());
            dto.setKeepaliveInterval(cfg.getKeepaliveInterval());
            dto.setStartupCommand(cfg.getStartupCommand());
            dto.setKnownHosts(cfg.getKnownHosts());
            dto.setStrictHostKeyCheck(cfg.isStrictHostKeyCheck());
            dto.setCompression(cfg.isCompression());
        }
        return dto;
    }
}
