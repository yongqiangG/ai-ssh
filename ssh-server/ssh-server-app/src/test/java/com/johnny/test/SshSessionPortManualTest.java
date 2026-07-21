package com.johnny.test;

import com.johnny.domain.ssh.adapter.port.ConnectParams;
import com.johnny.domain.ssh.adapter.port.ISshSessionPort;
import com.johnny.infrastructure.adapter.port.SshSessionPort;
import lombok.extern.slf4j.Slf4j;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * SshSessionPort 手动测试；不启动 Spring 环境，直接实例化实现类验证 SSH 基础能力。
 * <p>
 * 包含：初始状态、disconnect 幂等、连接失败返回 false、真实服务器的交互式终端。
 * 真实连接相关用例需手动运行（构建时 skipTests=true 不会执行）。
 */
@Slf4j
public class SshSessionPortManualTest {

    private static final String CONN_ID = "test-conn-1";

    /** 真实 SSH 连接信息；建议通过 -Dssh.host 等系统属性注入，避免硬编码敏感凭据到仓库 */
    private static final String HOST = System.getProperty("ssh.host", "10.10.10.10");
    private static final int PORT = Integer.parseInt(System.getProperty("ssh.port", "22"));
    private static final String USERNAME = System.getProperty("ssh.username", "root");
    private static final String PASSWORD = System.getProperty("ssh.password", "root");

    private ISshSessionPort sshSessionPort;

    @Before
    public void setUp() {
        sshSessionPort = new SshSessionPort();
    }

    @After
    public void tearDown() {
        sshSessionPort.disconnect(CONN_ID);
    }

    @Test
    public void test_isConnected_initialState_false() {
        assertFalse("不存在的连接应为未连接状态", sshSessionPort.isConnected(CONN_ID));
        log.info("初始连接状态校验通过 isConnected=false");
    }

    @Test
    public void test_disconnect_whenNotConnected_noException() {
        sshSessionPort.disconnect(CONN_ID);
        assertFalse("未连接时断开后仍应为未连接状态", sshSessionPort.isConnected(CONN_ID));
        log.info("未连接状态下调用 disconnect 幂等，无异常抛出");
    }

    @Test
    public void test_connect_invalidEndpoint_returnsFalse() {
        // 127.0.0.1:1 通常无服务监听，连接会被快速拒绝，应返回 false
        ConnectParams params = new ConnectParams();
        params.host = "127.0.0.1";
        params.port = 1;
        params.username = "nouser";
        params.password = "nopass";
        boolean ok = sshSessionPort.connect(CONN_ID, params).success;
        assertFalse("连接无效端点应返回 false", ok);
        assertFalse("连接失败后应为未连接状态", sshSessionPort.isConnected(CONN_ID));
        log.info("连接无效端点如期返回 false");
    }

    /**
     * 交互式终端：连接真实服务器后打开 shell，在控制台输入命令、查看服务器返回。
     * 输入 exit 或断开连接后退出。手动运行（构建时不会执行）。
     * <p>
     * 注意：IDE 的测试运行器默认不把键盘输入接入 System.in，若无法输入请改用 {@link #main} 方法运行。
     */
    @Test
    public void test_openShell_interactive() {
        boolean ok = sshSessionPort.connect(CONN_ID, passwordParams(HOST, PORT, USERNAME, PASSWORD)).success;
        assertTrue("真实服务器连接应成功", ok);
        sshSessionPort.openShell(CONN_ID, System.in, System.out);
    }

    /**
     * 交互式终端入口（main）；在 IDE 中右键运行，控制台可直接键入命令。
     */
    public static void main(String[] args) {
        ISshSessionPort port = new SshSessionPort();
        try {
            boolean ok = port.connect(CONN_ID, passwordParams(HOST, PORT, USERNAME, PASSWORD)).success;
            if (!ok) {
                System.out.println("连接失败，请检查主机/凭据");
                return;
            }
            port.openShell(CONN_ID, System.in, System.out);
        } finally {
            port.disconnect(CONN_ID);
        }
    }

    /** 组装密码认证的连接参数（高级配置走实现默认值） */
    private static ConnectParams passwordParams(String host, int port, String username, String password) {
        ConnectParams params = new ConnectParams();
        params.host = host;
        params.port = port;
        params.username = username;
        params.password = password;
        return params;
    }

}
