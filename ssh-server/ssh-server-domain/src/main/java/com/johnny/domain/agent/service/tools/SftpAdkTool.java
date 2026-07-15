package com.johnny.domain.agent.service.tools;

import com.google.adk.tools.Annotations;
import com.google.adk.tools.ToolContext;
import com.johnny.domain.ssh.adapter.port.ISftpPort;
import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.domain.ssh.adapter.port.SftpEntry;
import com.johnny.domain.ssh.service.ISshTerminalService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ADK 工具：在用户绑定的远程服务器上列出 SFTP 目录。
 *
 * <p>由 armory {@code AgentNode} 通过 {@code FunctionTool.create(sftpAdkTool, "listFiles")} 注册，
 * 与 {@link SshExecuteAdkTool}（{@code executeCommand}）并列。
 *
 * <p>核心契约：{@link #listFiles(String)} <b>永不抛异常</b>——任何失败都返回 {@code success:false} 的错误 Map，
 * 让 LLM 把失败当观察结果、转述给用户（与 {@code SshExecuteAdkTool} 一致）。
 *
 * <p>绑定链路：ADK sessionId → {@link TerminalContext} 取 terminalSessionId →
 * {@link ISshTerminalService#getConnectionId} 映射 connectionId → {@link ISshSessionPort#isConnected} 校验 →
 * {@link ISftpPort#list}。
 *
 * <p><b>注意</b>：项目根 pom 把 maven-compiler-plugin 锁在 3.0 无 {@code -parameters}，
 * 故 {@code path} 参数<b>必须</b>显式 {@code @Annotations.Schema(name="path")}。
 *
 * <p>upload/download 是二进制流，不适合直接做 LLM tool；{@code readFile}（读远程文本返回 LLM）作为同类后续扩展。
 */
@Slf4j
@Component
public class SftpAdkTool {

    /** 返回条目上限，超出截断并附 originalCount（对称 exec 的 8KB 截断思想，防 LLM 上下文爆炸） */
    private static final int MAX_ENTRIES = 200;

    @Resource
    private ISshTerminalService sshTerminalService;

    @Resource
    private ISshSessionPort sshSessionPort;

    @Resource
    private ISftpPort sftpPort;

    /**
     * 列出远程目录条目。
     *
     * @param path 远程目录绝对路径，例如 {@code /var/log}；{@code ~} 或空表示家目录
     * @return 结构化结果 Map（含 path/success/entries/count/truncated/可选 originalCount 或 error+analysis），LLM 直接消费其 JSON
     */
    public Map<String, Object> listFiles(
            ToolContext toolContext,
            @Annotations.Schema(name = "path",
                    description = "要列出的远程目录绝对路径，例如 /var/log；首次可用 / 或 ~ 表示家目录")
            String path) {

        String adkSessionId = toolContext.invocationContext().session().id();
        log.info("🔧 sftp 工具入口 thread={} adkSessionId={} path=[{}]",
                Thread.currentThread().getName(), adkSessionId, path);

        // 1) ADK sessionId → terminalSessionId（取代 ITL：流式下工具在池化线程执行，ITL 失效）
        String terminalSessionId = TerminalContext.getTerminalSessionId(adkSessionId);
        if (terminalSessionId == null || terminalSessionId.isBlank()) {
            return errorMap(path, "未绑定终端会话，请先在终端面板连接服务器",
                    "请用户先在左侧终端面板连接一台服务器，再提问。");
        }

        // 2) terminalSessionId → connectionId
        String connectionId;
        try {
            connectionId = sshTerminalService.getConnectionId(terminalSessionId);
        } catch (Exception e) {
            log.warn("终端会话查询异常 sessionId={} reason={}", terminalSessionId, e.getMessage());
            return errorMap(path, "终端会话已失效，请重新连接服务器",
                    "终端会话不存在或已关闭，请用户重新打开终端。");
        }
        if (connectionId == null) {
            return errorMap(path, "终端会话已失效，请重新连接服务器", null);
        }

        // 3) 校验 SSH 连接仍然在线
        if (!sshSessionPort.isConnected(connectionId)) {
            return errorMap(path, "SSH 连接已断开，请重新连接服务器",
                    "SSH 会话已掉线，请用户重新连接该服务器。");
        }

        // 4) list + 组装（>200 截断）
        String target = path == null || path.isBlank() ? "~" : path;
        try {
            List<SftpEntry> all = sftpPort.list(connectionId, target);
            int originalCount = all.size();
            boolean truncated = originalCount > MAX_ENTRIES;

            List<Map<String, Object>> entries = new ArrayList<>(Math.min(all.size(), MAX_ENTRIES));
            for (SftpEntry e : all) {
                if (entries.size() >= MAX_ENTRIES) {
                    break;
                }
                Map<String, Object> em = new LinkedHashMap<>();
                em.put("name", e.name);
                em.put("directory", e.directory);
                em.put("size", e.size);
                em.put("lastModified", e.lastModified);
                entries.add(em);
            }

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("path", target);
            m.put("success", true);
            m.put("entries", entries);
            m.put("count", entries.size());
            m.put("truncated", truncated);
            if (truncated) {
                m.put("originalCount", originalCount);
            }
            return m;
        } catch (Exception e) {
            log.warn("sftp 列目录失败 connectionId={} path=[{}] reason={}", connectionId, target, e.getMessage());
            return errorMap(target, "列目录失败：" + e.getMessage(),
                    "可能是路径不存在或无权限。建议先用 executeCommand 执行 ls 确认路径，或换用 ~ 列出家目录。");
        }
    }

    /** 构造错误 Map（前置失败用，未到 list）。 */
    private Map<String, Object> errorMap(String path, String error, String analysis) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("path", path);
        m.put("success", false);
        m.put("error", error);
        if (analysis != null) {
            m.put("analysis", analysis);
        }
        return m;
    }
}
