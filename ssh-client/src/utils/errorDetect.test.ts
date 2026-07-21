import { describe, expect, it } from "vitest";
import { errorKey, findErrorLine, stripAnsi } from "./errorDetect";

describe("stripAnsi", () => {
  it("去除 CSI 颜色码与 OSC 序列", () => {
    expect(stripAnsi("\x1b[31mError\x1b[0m: boom")).toBe("Error: boom");
    expect(stripAnsi("\x1b]0;title\x07ls -la")).toBe("ls -la");
  });
});

describe("findErrorLine", () => {
  it.each([
    "-bash: foo: command not found",
    "cat: /etc/nope: No such file or directory",
    "bash: /root/x.sh: Permission denied",
    "curl: (7) Failed to connect to 10.0.0.1 port 80: Connection refused",
    "ERROR 1045 (28000): Access denied for user 'root'@'localhost'",
    "fatal: not a git repository (or any of the parent directories): .git",
    "panic: runtime error: index out of range [3] with length 2",
    "Traceback (most recent call last):",
    "ValueError: invalid literal for int() with base 10: 'x'",
    "npm ERR! code ENOENT",
    "docker: Error response from daemon: pull access denied",
  ])("命中常见报错：%s", (line) => {
    expect(findErrorLine(`$ some-cmd\n${line}\n$`)).toBe(line);
  });

  it("带 ANSI 颜色的报错也能命中", () => {
    const out = findErrorLine("\x1b[1;31mfatal:\x1b[0m destination path exists");
    expect(out).toBe("fatal: destination path exists");
  });

  it("普通输出不命中", () => {
    const normal = [
      "total 48",
      "drwxr-xr-x 5 root root 4096 Jul 21 10:00 .",
      "$ grep error app.log",
      "Filesystem  Size  Used Avail Use% Mounted on",
      "Compiled successfully in 3.2s",
      "errors=0 warnings=0",
    ].join("\n");
    expect(findErrorLine(normal)).toBeNull();
  });

  it("空块返回 null", () => {
    expect(findErrorLine("")).toBeNull();
  });
});

describe("errorKey", () => {
  it("数字归一：同类报错不同端口/IP 得到相同 key", () => {
    const a = errorKey("curl: (7) Failed to connect to 10.0.0.1 port 80: Connection refused");
    const b = errorKey("curl: (7) Failed to connect to 10.0.0.9 port 8080: Connection refused");
    expect(a).toBe(b);
  });

  it("不同报错 key 不同", () => {
    expect(errorKey("bash: foo: command not found")).not.toBe(
      errorKey("cat: /x: No such file or directory")
    );
  });
});
