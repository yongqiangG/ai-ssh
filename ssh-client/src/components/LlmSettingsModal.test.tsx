import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LlmSettingsModal from "./LlmSettingsModal";
import { getLlmConfig, rollbackLlmConfig, saveLlmConfig } from "../api/llmConfig";
import { useChatStore } from "../stores/chatStore";

vi.mock("../api/llmConfig", () => ({
  getLlmConfig: vi.fn(),
  saveLlmConfig: vi.fn(),
  rollbackLlmConfig: vi.fn(),
}));

const currentConfig = {
  providerName: "Provider B",
  baseUrl: "https://b.example",
  model: "model-b",
  completionsPath: "/v1/chat/completions",
  apiKeyConfigured: true,
  rollbackAvailable: true,
  rollbackConfig: {
    providerName: "Provider A",
    baseUrl: "https://a.example",
    model: "model-a",
    completionsPath: "/v1/chat/completions",
    apiKeyConfigured: true,
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(getLlmConfig).mockResolvedValue(currentConfig);
  vi.mocked(saveLlmConfig).mockResolvedValue({
    ...currentConfig,
    configChanged: false,
    runnerReloadRequired: false,
    runnerRebuilt: false,
  });
  vi.mocked(rollbackLlmConfig).mockResolvedValue({
    ...currentConfig,
    rollbackAvailable: false,
    rollbackConfig: undefined,
    configChanged: true,
    runnerReloadRequired: true,
    runnerRebuilt: true,
  });
  useChatStore.setState({
    conversations: [],
    currentId: null,
    sending: false,
    loadAgents: vi.fn().mockResolvedValue(undefined),
    archiveAllAndStartNew: vi.fn(),
  } as never);
});

describe("LlmSettingsModal rollback", () => {
  it("shows the previous config summary without exposing the API key", async () => {
    render(<LlmSettingsModal open onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "回滚上一版" })).toBeTruthy();
    });

    expect(screen.getByText(/Provider A/)).toBeTruthy();
    expect(screen.queryByDisplayValue("key-a")).toBeNull();
  });

  it("confirms and executes rollback, then archives the active chat", async () => {
    const onClose = vi.fn();
    render(<LlmSettingsModal open onClose={onClose} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "回滚上一版" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "回滚上一版" }));
    expect(screen.getByText(/当前未保存的修改/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "回滚并新建会话" }));

    await waitFor(() => expect(vi.mocked(rollbackLlmConfig)).toHaveBeenCalledTimes(1));
    expect((useChatStore.getState().archiveAllAndStartNew as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables rollback while a chat is sending", async () => {
    useChatStore.setState({ sending: true } as never);
    render(<LlmSettingsModal open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "回滚上一版" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "回滚上一版" }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(rollbackLlmConfig)).not.toHaveBeenCalled();
  });
});
