package com.johnny.domain.agent.service.tools;

import com.google.adk.tools.Annotations;
import com.google.adk.tools.ToolContext;
import com.johnny.domain.agent.service.ConfirmGate;
import com.johnny.domain.ssh.adapter.port.ExecResult;
import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.domain.ssh.service.ISshTerminalService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * ADK 工具：在用户绑定的远程服务器上执行单条 SSH 命令（走独立 exec 通道，Q1）。
 *
 * <p>由 armory {@code AgentNode} 通过 {@code FunctionTool.create(sshExecuteAdkTool, "executeCommand")} 注册。
 *
 * <p>核心契约：{@link #executeCommand(String)} <b>永不抛异常</b>——任何失败都返回 {@code success:false} 的错误 Map，
 * 让 LLM 把失败当观察结果、转述给用户（Q3a）。
 *
 * <p>反编译参考：{@code docs/decompiled/google-adk/com/google/adk/tools/FunctionTool.java}
 * （{@code create(Object,String)} 实例方法注册、参数 @Schema 校验规则 line 112-127）。
 *
 * <p><b>注意</b>：项目根 pom 把 maven-compiler-plugin 锁在 3.0 无 {@code -parameters}，
 * 故 {@code command} 参数<b>必须</b>显式 {@code @Schema(name="command")}（否则 FunctionTool 拿不到参数名）。
 */
@Slf4j
@Component
public class SshExecuteAdkTool {

    @Resource
    private ISshTerminalService sshTerminalService;

    @Resource
    private ISshSessionPort sshSessionPort;

    @Resource
    private ConfirmGate confirmGate;

    /**
     * 执行一条远程命令。
     * <p>调用链：黑名单 → 确认门（写操作挂起等用户允许，B1）→ 终端绑定校验 → exec → 组装结果 Map。
     *
     * @param command 要执行的 shell 命令（单条）
     * @param intent  模型自评意图：read=只读查询；write=会修改系统状态（确认门双通道之一）
     * @return 结构化结果 Map，LLM 直接消费其 JSON
     */
    public Map<String, Object> executeCommand(
            ToolContext toolContext,
            @Annotations.Schema(name = "command",
                    description = "要在远程服务器上执行的单条 shell 命令，例如 cat /etc/os-release")
            String command,
            @Annotations.Schema(name = "intent", optional = true,
                    description = "命令意图自评：read=只读查询不改变系统状态；write=会修改文件/进程/服务/配置等系统状态。必须如实声明")
            String intent) {

        String adkSessionId = toolContext.invocationContext().session().id();
        // 1) 按 ADK sessionId 查询绑定的终端 sessionId（取代 ITL：流式下工具在池化线程执行，ITL 失效）
        String terminalSessionId = TerminalContext.getTerminalSessionId(adkSessionId);
        log.info("🔧 工具入口 thread={} adkSessionId={} terminalSessionId={} intent={} command=[{}]",
                Thread.currentThread().getName(), adkSessionId, terminalSessionId, intent, command);

        // 2) 黑名单校验（Q12）——命中即拦截，不执行（确认门之前的硬底线）
        if (isBlocked(command)) {
            log.warn("命令被安全策略拦截 command=[{}]", command);
            return errorMap(command, "该命令被安全策略拦截，禁止执行（危险命令）",
                    "命令命中黑名单，请换用安全的等价命令或联系管理员。");
        }

        // 3) 确认门（B1）：写模式规则 OR 模型自评 write → 挂起等用户允许；拒绝/超时不执行
        if (CommandClassifier.needsConfirm(command, intent)) {
            String reason = CommandClassifier.matchesWritePattern(command)
                    ? "命令命中写操作规则" : "模型声明该命令会修改系统状态";
            boolean allowed = confirmGate.requestConfirm(
                    adkSessionId, toolContext.functionCallId().orElse(""), command, reason);
            if (!allowed) {
                return errorMap(command, "用户未允许执行该写操作命令",
                        "用户拒绝或未在时限内确认。请询问用户意图，或改用只读命令完成任务。");
            }
        }

        // 4) 校验终端绑定
        if (terminalSessionId == null || terminalSessionId.isBlank()) {
            return errorMap(command, "未绑定终端会话，请先在终端面板连接服务器",
                    "请用户在左侧终端面板先连接一台服务器，再提问。");
        }

        // 4) terminalSessionId → connectionId（§4.7.3 新增接口）
        String connectionId;
        try {
            connectionId = sshTerminalService.getConnectionId(terminalSessionId);
        } catch (Exception e) {
            log.warn("终端会话查询异常 sessionId={} reason={}", terminalSessionId, e.getMessage());
            return errorMap(command, "终端会话已失效，请重新连接服务器",
                    "终端会话不存在或已关闭，请用户重新打开终端。");
        }
        if (connectionId == null) {
            return errorMap(command, "终端会话已失效，请重新连接服务器", null);
        }

        // 5) 校验 SSH 连接仍然在线
        if (!sshSessionPort.isConnected(connectionId)) {
            return errorMap(command, "SSH 连接已断开，请重新连接服务器",
                    "SSH 会话已掉线，请用户重新连接该服务器。");
        }

        // 6) exec（独立通道，30s 超时，Q4）
        ExecResult r = sshSessionPort.exec(connectionId, command, 30_000L);
        if (r == null) {
            return errorMap(command, "SSH 连接已断开，请重新连接服务器", null);
        }

        // 7) 组装返回 Map（Q9：8 字段）
        return assembleResult(command, r);
    }

    /** 组装成功/失败的统一返回 Map；失败时额外附加 analysis 字段（Q9）。 */
    private Map<String, Object> assembleResult(String command, ExecResult r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("command", command);
        boolean success = !r.timedOut && r.exitCode == 0;
        m.put("success", success);
        m.put("exitCode", r.exitCode);
        m.put("stdout", r.stdout);
        m.put("stderr", r.stderr);
        m.put("timedOut", r.timedOut);
        // truncated：stdout/stderr 任一被截断即为 true，并附原始字节数
        boolean truncated = r.stdoutTruncated || r.stderrTruncated;
        m.put("truncated", truncated);
        if (truncated) {
            m.put("originalBytes", "stdout=" + r.stdoutOriginalBytes + ",stderr=" + r.stderrOriginalBytes);
        }
        // analysis：仅失败时出现，规则不命中则省略（Q9）
        if (!success) {
            String analysis = analyzeFailure(r);
            if (analysis != null) {
                m.put("analysis", analysis);
            }
        }
        return m;
    }

    /** 构造错误 Map（执行前的拦截/前置失败用，未到 exec）。 */
    private Map<String, Object> errorMap(String command, String error, String analysis) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("command", command);
        m.put("success", false);
        m.put("error", error);
        if (analysis != null) {
            m.put("analysis", analysis);
        }
        return m;
    }

    /**
     * 失败分析（Q9）：纯字符串规则匹配，不调模型。首批 5 条规则。
     *
     * @return 中文建议；不命中返回 null（调用方据此省略 analysis 字段）
     */
    private String analyzeFailure(ExecResult r) {
        String stderr = r.stderr == null ? "" : r.stderr.toLowerCase();
        if (r.timedOut) {
            return "命令执行超时（30s）。可能是交互式或长驻命令（如 top、vim、tail -f）。建议换非交互形式，例如 top → top -bn1，tail -f → tail -n 100。";
        }
        if (stderr.contains("command not found") || stderr.contains("not found")) {
            return "命令拼写错误或软件未安装。建议先用包管理器安装，或换等价命令。";
        }
        if (stderr.contains("permission denied")) {
            return "权限不足。建议检查文件权限，或对受信任的命令加 sudo 前缀（需用户确认）。";
        }
        if (stderr.contains("no such file or directory")) {
            return "路径不存在。建议先 ls 确认目标路径后再执行。";
        }
        return null;
    }

    // === 危险命令黑名单（Q12）：命中即拦截 ===
    private static final List<Pattern> BLOCKED = List.of(
            // rm 递归强删根/家目录：兼容 -rf 与 -fr 两种字母顺序，以及 --force
            Pattern.compile("\\brm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--force)[a-z-]*\\s+(/|~|\\*|\\$HOME)"),
            Pattern.compile("\\bmkfs\\b"),
            Pattern.compile("\\bdd\\s+.*\\bof=/dev/"),
            Pattern.compile("\\b(shutdown|reboot|halt|poweroff|init\\s+0)\\b"),
            Pattern.compile(":\\(\\)\\s*\\{\\s*:\\|:&\\s*\\}\\s*;\\s*:"),    // fork 炸弹
            Pattern.compile("\\b>(\\s*)/dev/sd[a-z]"),
            Pattern.compile("\\bchmod\\s+-R\\s+000\\s+/"),
            Pattern.compile("\\b>(\\s*)/dev/null\\s+<\\s*/dev/")
    );

    /** 包私有静态：便于单测直接验证黑名单规则 */
    static boolean isBlocked(String command) {
        if (command == null) {
            return false;
        }
        for (Pattern p : BLOCKED) {
            if (p.matcher(command).find()) {
                return true;
            }
        }
        return false;
    }
}
