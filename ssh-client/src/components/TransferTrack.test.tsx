import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TransferItem } from "../stores/sftpStore";
import TransferTrack from "./TransferTrack";

const transfer = (overrides: Partial<TransferItem> = {}): TransferItem => ({
  id: "tx-1",
  direction: "download",
  name: "app.log",
  progress: 1,
  status: "done",
  localPath: "C:\\logs\\app.log",
  openState: "idle",
  ...overrides,
});

describe("TransferTrack 下载打开入口", () => {
  it("仅下载成功项显示打开按钮并触发打开操作", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <TransferTrack transfer={transfer()} onOpen={onOpen} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 app.log" }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    rerender(
      <TransferTrack
        transfer={transfer({ direction: "upload", localPath: undefined })}
        onOpen={onOpen}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /打开 app\.log/ })).toBeNull();
  });

  it("打开中禁用按钮，成功后显示已打开", () => {
    const { rerender } = render(
      <TransferTrack
        transfer={transfer({ openState: "opening" })}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "打开 app.log",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    rerender(
      <TransferTrack
        transfer={transfer({ openState: "opened" })}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "已打开 app.log" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toContain("已打开");
  });

  it("打开失败时展示错误并保留可点击按钮", () => {
    render(
      <TransferTrack
        transfer={transfer({ openError: "打开文件失败：没有关联的应用" })}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("打开文件失败：没有关联的应用")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "打开 app.log",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
