package com.johnny.infrastructure.lifecycle;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * stdin 哨兵测试：EOF / 流异常触发退出回调，开关关闭时不启动。
 */
public class StdinWatchdogTest {

    @Test
    public void eof_triggers_exit_callback() throws Exception {
        CountDownLatch exited = new CountDownLatch(1);
        // 空流开局即 EOF
        StdinWatchdog.watch(new ByteArrayInputStream(new byte[0]), exited::countDown);
        assertTrue("EOF 后应触发退出回调", exited.await(2, TimeUnit.SECONDS));
    }

    @Test
    public void data_then_eof_triggers_exit_callback() throws Exception {
        CountDownLatch exited = new CountDownLatch(1);
        PipedOutputStream writer = new PipedOutputStream();
        PipedInputStream reader = new PipedInputStream(writer);
        StdinWatchdog.watch(reader, exited::countDown);

        writer.write("noise".getBytes());
        writer.flush();
        assertFalse("有数据流入时不应退出", exited.await(300, TimeUnit.MILLISECONDS));

        writer.close();
        assertTrue("写端关闭（EOF）后应触发退出回调", exited.await(2, TimeUnit.SECONDS));
    }

    @Test
    public void stream_failure_triggers_exit_callback() throws Exception {
        CountDownLatch exited = new CountDownLatch(1);
        InputStream broken = new InputStream() {
            @Override
            public int read() throws IOException {
                throw new IOException("pipe broken");
            }
        };
        StdinWatchdog.watch(broken, exited::countDown);
        assertTrue("流异常等同管道断裂，应触发退出回调", exited.await(2, TimeUnit.SECONDS));
    }

    @Test
    public void watcher_thread_is_daemon() {
        Thread thread = StdinWatchdog.watch(new ByteArrayInputStream(new byte[0]), () -> { });
        assertTrue("哨兵线程必须是守护线程，不得阻碍 JVM 正常退出", thread.isDaemon());
    }

    @Test
    public void start_if_enabled_respects_property_gate() {
        String old = System.clearProperty(StdinWatchdog.ENABLE_PROPERTY);
        try {
            assertNull("开关未开时不应启动哨兵", StdinWatchdog.startIfEnabled());

            System.setProperty(StdinWatchdog.ENABLE_PROPERTY, "false");
            assertNull("开关显式为 false 时不应启动哨兵", StdinWatchdog.startIfEnabled());
        } finally {
            if (old != null) {
                System.setProperty(StdinWatchdog.ENABLE_PROPERTY, old);
            }
        }
    }
}
