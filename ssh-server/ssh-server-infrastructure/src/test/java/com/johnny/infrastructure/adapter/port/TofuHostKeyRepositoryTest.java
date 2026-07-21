package com.johnny.infrastructure.adapter.port;

import com.jcraft.jsch.HostKeyRepository;
import org.junit.Test;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * TOFU 主机密钥仓库三态判定测试：未知（NOT_INCLUDED）/ 匹配（OK）/ 变更（CHANGED）。
 */
public class TofuHostKeyRepositoryTest {

    /** 构造最小合法 ssh key blob：length-prefixed 算法名 + length-prefixed 密钥材料 */
    private static byte[] fakeKey(String type, byte[] material) {
        byte[] typeBytes = type.getBytes(StandardCharsets.US_ASCII);
        ByteBuffer buf = ByteBuffer.allocate(4 + typeBytes.length + 4 + material.length);
        buf.putInt(typeBytes.length).put(typeBytes).putInt(material.length).put(material);
        return buf.array();
    }

    private static byte[] material(int seed) {
        byte[] m = new byte[32];
        for (int i = 0; i < m.length; i++) {
            m[i] = (byte) (seed + i);
        }
        return m;
    }

    private static String line(String host, String type, byte[] key) {
        return host + " " + type + " " + Base64.getEncoder().encodeToString(key);
    }

    @Test
    public void unknown_host_returns_not_included_and_captures_line() {
        TofuHostKeyRepository repo = new TofuHostKeyRepository("");
        byte[] key = fakeKey("ssh-ed25519", material(1));

        int result = repo.check("10.0.0.1", key);

        assertEquals(HostKeyRepository.NOT_INCLUDED, result);
        TofuHostKeyRepository.Capture c = repo.getCapture();
        assertNotNull(c);
        assertEquals("10.0.0.1", c.host);
        assertEquals("ssh-ed25519", c.keyType);
        assertTrue(c.fingerprintSha256.startsWith("SHA256:"));
        assertNull(c.oldFingerprintSha256);
        assertEquals(line("10.0.0.1", "ssh-ed25519", key), c.knownHostLine);
    }

    @Test
    public void known_host_same_key_returns_ok() {
        byte[] key = fakeKey("ssh-ed25519", material(1));
        TofuHostKeyRepository repo = new TofuHostKeyRepository(line("10.0.0.1", "ssh-ed25519", key));

        assertEquals(HostKeyRepository.OK, repo.check("10.0.0.1", key));
        assertNull("匹配时不应产生捕获现场", repo.getCapture());
    }

    @Test
    public void known_host_different_key_returns_changed_with_old_fingerprint() {
        byte[] oldKey = fakeKey("ssh-ed25519", material(1));
        byte[] newKey = fakeKey("ssh-ed25519", material(9));
        TofuHostKeyRepository repo = new TofuHostKeyRepository(line("10.0.0.1", "ssh-ed25519", oldKey));

        int result = repo.check("10.0.0.1", newKey);

        assertEquals(HostKeyRepository.CHANGED, result);
        TofuHostKeyRepository.Capture c = repo.getCapture();
        assertNotNull(c);
        assertNotNull("CHANGED 必须带旧指纹供前端对比", c.oldFingerprintSha256);
        assertEquals(TofuHostKeyRepository.sha256Fingerprint(oldKey), c.oldFingerprintSha256);
        assertEquals(TofuHostKeyRepository.sha256Fingerprint(newKey), c.fingerprintSha256);
    }

    @Test
    public void bracketed_host_port_form_matches_exactly() {
        byte[] key = fakeKey("ssh-rsa", material(3));
        TofuHostKeyRepository repo = new TofuHostKeyRepository(line("[10.0.0.1]:2222", "ssh-rsa", key));

        assertEquals(HostKeyRepository.OK, repo.check("[10.0.0.1]:2222", key));
        assertEquals(HostKeyRepository.NOT_INCLUDED, repo.check("10.0.0.1", key));
    }

    @Test
    public void malformed_lines_are_ignored() {
        byte[] key = fakeKey("ssh-ed25519", material(1));
        String content = "# comment\n\nnot-a-valid-line\n" + line("10.0.0.1", "ssh-ed25519", key);
        TofuHostKeyRepository repo = new TofuHostKeyRepository(content);

        assertEquals(HostKeyRepository.OK, repo.check("10.0.0.1", key));
    }
}
