import { describe, expect, it } from "vitest";
import { sanitizeTerminalContext } from "./sanitize";

describe("sanitizeTerminalContext", () => {
  it("掩码键值对形态的凭据", () => {
    const out = sanitizeTerminalContext(
      "DB_PASSWORD=Sup3rS3cret!\nexport API_KEY: abcd1234efgh\ntoken=\"tok_9f8e7d6c\""
    );
    expect(out).not.toContain("Sup3rS3cret!");
    expect(out).not.toContain("abcd1234efgh");
    expect(out).not.toContain("tok_9f8e7d6c");
    expect(out).toContain("DB_PASSWORD=***");
  });

  it("掩码 PEM 私钥块", () => {
    const pem =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nmore\n-----END OPENSSH PRIVATE KEY-----";
    const out = sanitizeTerminalContext(`cat id_ed25519\n${pem}\ndone`);
    expect(out).not.toContain("b3BlbnNzaC1rZXktdjEAAAAA");
    expect(out).toContain("***");
  });

  it("掩码 AWS key / JWT / Bearer", () => {
    const out = sanitizeTerminalContext(
      "AKIAIOSFODNN7EXAMPLE\nAuthorization: Bearer abcdef1234567890abcdef\neyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c"
    );
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c");
    expect(out).toMatch(/Bearer\s+\*\*\*/);
  });

  it("普通运维输出不受影响", () => {
    const text =
      "Filesystem  Size  Used Avail Use% Mounted on\n/dev/vda1    40G   12G   26G  32% /\nnginx: master process /usr/sbin/nginx";
    expect(sanitizeTerminalContext(text)).toBe(text);
  });
});
