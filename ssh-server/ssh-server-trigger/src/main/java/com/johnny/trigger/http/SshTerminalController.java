package com.johnny.trigger.http;

import com.johnny.api.dto.TerminalCommandRequestDTO;
import com.johnny.api.dto.TerminalOpenRequestDTO;
import com.johnny.api.dto.TerminalOpenResponseDTO;
import com.johnny.api.dto.TerminalReadResponseDTO;
import com.johnny.api.dto.TerminalResizeRequestDTO;
import com.johnny.api.dto.TerminalWriteRequestDTO;
import com.johnny.api.response.Response;
import com.johnny.domain.ssh.service.ISshTerminalService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * SSH 终端 HTTP 接口。
 * <p>
 * 将领域服务 {@link ISshTerminalService} 封装为 REST：打开会话、整行命令、逐字节写入、
 * 轮询读输出、调整尺寸、关闭会话。DTO↔领域命令/结果的转换在本层完成。
 * 前端轮询模型：写操作即时下发；输出由 GET read 定时（约 50ms）拉取增量。
 */
@RestController
@RequestMapping("/api/ssh/terminals")
public class SshTerminalController {

    private final ISshTerminalService sshTerminalService;

    public SshTerminalController(ISshTerminalService sshTerminalService) {
        this.sshTerminalService = sshTerminalService;
    }

    /** 打开终端会话；阻塞等待初始输出（motd/提示符）积累完后一并返回 */
    @PostMapping("/open")
    public Response<TerminalOpenResponseDTO> open(@RequestBody TerminalOpenRequestDTO dto,
                                                  @RequestHeader(value = "X-User-Id", required = false, defaultValue = "default") String userId) {
        ISshTerminalService.OpenCmd cmd = new ISshTerminalService.OpenCmd();
        cmd.connectionId = dto.getConnectionId();
        cmd.userId = userId;
        cmd.cols = dto.getCols();
        cmd.rows = dto.getRows();
        ISshTerminalService.OpenResult result = sshTerminalService.open(cmd);
        TerminalOpenResponseDTO resp = new TerminalOpenResponseDTO();
        resp.setSessionId(result.sessionId);
        resp.setOutput(result.initialOutput);
        return Response.success(resp);
    }

    /** 执行整行命令（自动补换行；AI 执行命令场景），输出经 read 轮询流回 */
    @PostMapping("/{sessionId}/command")
    public Response<Void> command(@PathVariable("sessionId") String sessionId,
                                  @RequestBody TerminalCommandRequestDTO dto) {
        sshTerminalService.execCommand(sessionId, dto.getCommand());
        return Response.success(null);
    }

    /** 逐字节原样写入（用户键入与控制序列透传） */
    @PostMapping("/{sessionId}/write")
    public Response<Void> write(@PathVariable("sessionId") String sessionId,
                                @RequestBody TerminalWriteRequestDTO dto) {
        sshTerminalService.write(sessionId, dto.getData());
        return Response.success(null);
    }

    /** 读取增量输出；closed=true 为后端断联标记，前端应停止轮询 */
    @GetMapping("/{sessionId}/read")
    public Response<TerminalReadResponseDTO> read(@PathVariable("sessionId") String sessionId) {
        ISshTerminalService.ReadResult result = sshTerminalService.read(sessionId);
        TerminalReadResponseDTO resp = new TerminalReadResponseDTO();
        resp.setContent(result.content);
        resp.setClosed(result.closed);
        return Response.success(resp);
    }

    /** 调整远端伪终端窗口尺寸 */
    @PostMapping("/{sessionId}/resize")
    public Response<Void> resize(@PathVariable("sessionId") String sessionId,
                                 @RequestBody TerminalResizeRequestDTO dto) {
        sshTerminalService.resize(sessionId, dto.getCols(), dto.getRows());
        return Response.success(null);
    }

    /** 关闭终端会话（幂等） */
    @PostMapping("/{sessionId}/close")
    public Response<Void> close(@PathVariable("sessionId") String sessionId) {
        sshTerminalService.close(sessionId);
        return Response.success(null);
    }
}
