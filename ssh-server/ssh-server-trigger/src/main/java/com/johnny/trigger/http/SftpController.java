package com.johnny.trigger.http;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.johnny.api.dto.SftpEntryDTO;
import com.johnny.api.response.Response;
import com.johnny.domain.ssh.adapter.port.SftpEntry;
import com.johnny.domain.ssh.service.ISftpService;
import com.johnny.types.enums.ResponseCode;
import com.johnny.types.exception.AppException;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Collectors;

/**
 * SFTP 文件传输 HTTP 接口。
 * <p>将领域服务 {@link ISftpService} 封装为 REST：列目录、上传（multipart）、下载（octet-stream 流）。
 * <p>Controller 参数显式命名——项目根 pom 把 maven-compiler-plugin 锁在 3.0 无 {@code -parameters}。
 *
 * <p><b>下载异常自处理</b>：download 先 setContentType("application/octet-stream")，若 service 抛异常，
 * {@link GlobalExceptionHandler} 想返回 JSON 会因 preset Content-Type 冲突抛 HttpMessageNotWritableException
 * （No converter for Response with preset Content-Type 'application/octet-stream'）。
 * 故 download 自己 catch → response.reset() → 手写 JSON 错误，绕开全局 handler。
 */
@Slf4j
@RestController
@RequestMapping("/api/ssh/sftp")
public class SftpController {

    /** 单文件上传软上限（100MB）；multipart 超 10MB 部分落磁盘临时文件，不占满堆 */
    private static final long MAX_UPLOAD_BYTES = 100L * 1024 * 1024;

    private final ISftpService sftpService;
    private final ObjectMapper objectMapper;

    public SftpController(ISftpService sftpService, ObjectMapper objectMapper) {
        this.sftpService = sftpService;
        this.objectMapper = objectMapper;
    }

    /** 列出远程目录条目 */
    @GetMapping("/list")
    public Response<List<SftpEntryDTO>> list(@RequestParam("connectionId") String connectionId,
                                             @RequestParam(value = "path", required = false, defaultValue = "~") String path) {
        List<SftpEntry> entries = sftpService.list(connectionId, path);
        List<SftpEntryDTO> dtos = entries.stream()
                .map(SftpController::toDTO)
                .collect(Collectors.toList());
        return Response.success(dtos);
    }

    /** 上传文件（multipart）；overwrite=false 且目标存在时由服务层抛 AppException */
    @PostMapping("/upload")
    public Response<Void> upload(@RequestParam("connectionId") String connectionId,
                                 @RequestParam("remotePath") String remotePath,
                                 @RequestParam(value = "overwrite", defaultValue = "false") boolean overwrite,
                                 @RequestParam("file") MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(), "上传文件为空");
        }
        if (file.getSize() > MAX_UPLOAD_BYTES) {
            throw new AppException(ResponseCode.ILLEGAL_PARAMETER.getCode(),
                    "文件超过 " + (MAX_UPLOAD_BYTES / 1024 / 1024) + "MB 上限");
        }
        try (InputStream in = file.getInputStream()) {
            sftpService.upload(connectionId, remotePath, in, overwrite);
        }
        return Response.success(null);
    }

    /**
     * 下载远程文件，以 octet-stream 流回前端。
     * <p>Content-Disposition 带文件名；前端拿 blob 后自行写盘。异常自处理（见类注释）。
     */
    @GetMapping("/download")
    public void download(@RequestParam("connectionId") String connectionId,
                         @RequestParam("remotePath") String remotePath,
                         HttpServletResponse response) throws IOException {
        try {
            String filename = remotePath.contains("/")
                    ? remotePath.substring(remotePath.lastIndexOf('/') + 1)
                    : remotePath;
            response.setContentType("application/octet-stream");
            response.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
            sftpService.download(connectionId, remotePath, response.getOutputStream());
            response.flushBuffer();
        } catch (AppException ae) {
            writeJsonError(response,
                    ae.getCode() == null ? ResponseCode.UN_ERROR.getCode() : ae.getCode(),
                    ae.getInfo());
        } catch (Exception e) {
            log.error("SFTP 下载失败 connectionId={} remotePath={}", connectionId, remotePath, e);
            writeJsonError(response, ResponseCode.UN_ERROR.getCode(), "下载失败：" + e.getMessage());
        }
    }

    /**
     * 未提交时 reset + 写 JSON 错误；已提交（流写到一半断）则只记日志，前端拿到截断。
     * <p>用 getOutputStream 写 bytes：try 里已调过 getOutputStream，再调 getWriter 会抛
     * IllegalStateException（二者互斥），故统一走 getOutputStream。
     */
    private void writeJsonError(HttpServletResponse response, String code, String info) throws IOException {
        if (response.isCommitted()) {
            log.warn("下载失败但响应已提交，无法返回 JSON: code={} info={}", code, info);
            return;
        }
        response.reset();
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType("application/json;charset=UTF-8");
        byte[] body = objectMapper.writeValueAsString(Response.fail(code, info))
                .getBytes(StandardCharsets.UTF_8);
        response.getOutputStream().write(body);
        response.flushBuffer();
    }

    private static SftpEntryDTO toDTO(SftpEntry e) {
        SftpEntryDTO dto = new SftpEntryDTO();
        dto.setName(e.name);
        dto.setDirectory(e.directory);
        dto.setSize(e.size);
        dto.setLastModified(e.lastModified);
        return dto;
    }
}
