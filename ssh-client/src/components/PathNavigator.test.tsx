import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { remoteCrumbs } from "../stores/sftpStore";
import PathNavigator from "./PathNavigator";

describe("统一路径导航", () => {
  it("远程显示根与家目录入口，并可通过上一级返回根目录", () => {
    const onNavigate = vi.fn().mockResolvedValue(true);
    render(
      <PathNavigator
        title="远程"
        side="remote"
        cwd="~"
        parentPath="/"
        crumbs={remoteCrumbs("~")}
        loading={false}
        error={null}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole("button", { name: "/" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "~" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回上一级远程" }));
    expect(onNavigate).toHaveBeenCalledWith("/");
  });

  it("编辑路径后按 Enter 提交，失败时保留编辑态", async () => {
    const onNavigate = vi.fn().mockResolvedValue(false);
    render(
      <PathNavigator
        title="远程"
        side="remote"
        cwd="/var/log"
        parentPath="/var"
        crumbs={remoteCrumbs("/var/log")}
        loading={false}
        error="目录不存在"
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑远程路径" }));
    const input = screen.getByRole("textbox", { name: "输入远程路径" });
    fireEvent.change(input, { target: { value: "../tmp" } });
    fireEvent.submit(input.closest("form")!);
    expect(onNavigate).toHaveBeenCalledWith("../tmp");
    expect(screen.getByRole("textbox", { name: "输入远程路径" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("目录不存在");
  });

  it("本地盘符面包屑提供可读取磁盘列表", () => {
    const onNavigate = vi.fn().mockResolvedValue(true);
    render(
      <PathNavigator
        title="本地"
        side="local"
        cwd="C:\\work"
        parentPath="C:\\"
        crumbs={[
          { label: "C:\\", path: "C:\\" },
          { label: "work", path: "C:\\work" },
        ]}
        drives={["C:\\", "D:\\"]}
        loading={false}
        error={null}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "本地磁盘" }), {
      target: { value: "D:\\" },
    });
    expect(onNavigate).toHaveBeenCalledWith("D:\\");
  });
});
