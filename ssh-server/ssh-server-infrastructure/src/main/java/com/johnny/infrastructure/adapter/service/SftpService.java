package com.johnny.infrastructure.adapter.service;

import com.johnny.domain.ssh.adapter.port.ISftpPort;
import com.johnny.domain.ssh.adapter.port.SftpEntry;
import com.johnny.domain.ssh.service.ISftpService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

/**
 * {@link ISftpService} 实现：对 {@link ISftpPort} 薄委托。
 * <p>当前无额外编排逻辑，保留服务层以维持 DDD 分层一致性（controller 依赖领域服务接口而非 infra port）。
 */
@Component
public class SftpService implements ISftpService {

    @Resource
    private ISftpPort sftpPort;

    @Override
    public List<SftpEntry> list(String connectionId, String path) {
        return sftpPort.list(connectionId, path);
    }

    @Override
    public void upload(String connectionId, String remotePath, InputStream in, boolean overwrite) {
        sftpPort.upload(connectionId, remotePath, in, overwrite);
    }

    @Override
    public void download(String connectionId, String remotePath, OutputStream out) {
        sftpPort.download(connectionId, remotePath, out);
    }
}
