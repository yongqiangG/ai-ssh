package com.johnny.trigger.http;

import com.johnny.api.dto.SshKeyCreateRequestDTO;
import com.johnny.api.dto.SshKeyDTO;
import com.johnny.api.dto.SshKeyUpdateRequestDTO;
import com.johnny.api.response.Response;
import com.johnny.domain.ssh.model.entity.SshKeyEntity;
import com.johnny.domain.ssh.service.ISshKeyService;
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
 * SSH 密钥管理 HTTP 接口（一等实体 CRUD）。
 * <p>
 * privateKey/passphrase 只写不回显；连接经 keyId 引用密钥。userId 由请求头 {@code X-User-Id} 注入。
 */
@RestController
@RequestMapping("/api/ssh/keys")
public class SshKeyController {

    private final ISshKeyService sshKeyService;

    public SshKeyController(ISshKeyService sshKeyService) {
        this.sshKeyService = sshKeyService;
    }

    /** 创建密钥，返回 keyId */
    @PostMapping
    public Response<String> create(@RequestBody SshKeyCreateRequestDTO dto,
                                   @RequestHeader(value = "X-User-Id", required = false, defaultValue = "default") String userId) {
        ISshKeyService.CreateCmd cmd = new ISshKeyService.CreateCmd();
        cmd.userId = userId;
        cmd.name = dto.getName();
        cmd.privateKey = dto.getPrivateKey();
        cmd.passphrase = dto.getPassphrase();
        return Response.success(sshKeyService.create(cmd));
    }

    /** 更新密钥（留空字段不修改） */
    @PutMapping("/{keyId}")
    public Response<Void> update(@PathVariable("keyId") String keyId,
                                 @RequestBody SshKeyUpdateRequestDTO dto) {
        ISshKeyService.UpdateCmd cmd = new ISshKeyService.UpdateCmd();
        cmd.name = dto.getName();
        cmd.privateKey = dto.getPrivateKey();
        cmd.passphrase = dto.getPassphrase();
        sshKeyService.update(keyId, cmd);
        return Response.success(null);
    }

    /** 列出当前用户全部密钥 */
    @GetMapping
    public Response<List<SshKeyDTO>> list(
            @RequestHeader(value = "X-User-Id", required = false, defaultValue = "default") String userId) {
        List<SshKeyDTO> list = sshKeyService.list(userId).stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
        return Response.success(list);
    }

    /** 删除密钥（被连接引用时返回错误） */
    @DeleteMapping("/{keyId}")
    public Response<Void> remove(@PathVariable("keyId") String keyId) {
        sshKeyService.remove(keyId);
        return Response.success(null);
    }

    private SshKeyDTO toDTO(SshKeyEntity entity) {
        SshKeyDTO dto = new SshKeyDTO();
        dto.setKeyId(entity.getKeyId());
        dto.setName(entity.getName());
        dto.setPassphraseConfigured(entity.hasPassphrase());
        return dto;
    }
}
