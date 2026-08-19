import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentModelCatalogSection } from "../components/app-settings/AgentModelCatalogSection";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "../components/app-settings/types";
import { I18nProvider } from "../i18n";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function renderSection(agentKey: "claude" | "codex") {
  return render(
    <I18nProvider>
      <AgentModelCatalogSection agentKey={agentKey} />
    </I18nProvider>,
  );
}

describe("AgentModelCatalogSection", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("keeps Claude manual-only", async () => {
    invokeMock.mockResolvedValue(DEFAULT_APP_SETTINGS);
    renderSection("claude");

    expect((await screen.findByText(/manual only/i)) !== null).toBe(true);
    expect(screen.queryByRole("button", { name: "Initialize once" })).toBeNull();
  });

  it("offers Codex initialization only until the first successful import", async () => {
    const initialized: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      codex_model_catalog: {
        initialized: true,
        sourceVersion: "0.144.0",
        models: [
          {
            model: "gpt-example",
            label: "GPT Example",
            reasoningEfforts: ["low", "high"],
          },
        ],
      },
    };
    let currentSettings = DEFAULT_APP_SETTINGS;
    invokeMock.mockImplementation((command: string) => {
      if (command === "coding_initialize_agent_model_catalog") {
        currentSettings = initialized;
      }
      return Promise.resolve(currentSettings);
    });
    renderSection("codex");

    const initButton = await screen.findByRole("button", { name: "Initialize once" });
    // 存量竞态修复:按钮在首次设置加载完成前就渲染(disabled 态),原生 click
    // 对 disabled 按钮是空操作——必须等到加载落定、按钮启用后再点,
    // 否则 handleInitialize 永不执行,按钮永不消失,waitFor 必然超时。
    await waitFor(() =>
      expect((initButton as HTMLButtonElement).disabled).toBe(false),
    );
    initButton.click();

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Initialize once" })).toBeNull(),
    );
    expect(screen.getByDisplayValue("gpt-example") !== null).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("coding_initialize_agent_model_catalog", {
      agent: "codex",
    });
  });
});
