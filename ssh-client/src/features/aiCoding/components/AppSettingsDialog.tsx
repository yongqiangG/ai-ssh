import { Fragment, useState } from "react";
import { X, Keyboard, Settings as SettingsIcon, Type, Zap } from "lucide-react";
import type { TerminalFontSize, TerminalScrollback, TaskDisplayWindow, FontFamily } from "../types";
import { useI18n } from "../i18n";
import s from "../styles";
import claudeLogo from "../assets/claude.svg";
import chatgptLogo from "../assets/chatgpt.svg";
import { AgentConfigPanel } from "./app-settings/AgentConfigPanel";
import { GeneralPanel } from "./app-settings/GeneralPanel";
import { ShortcutsPanel } from "./app-settings/ShortcutsPanel";
import { FontPanel } from "./app-settings/FontPanel";
import { HooksPanel } from "./app-settings/HooksPanel";
import { getAgentSettingsFilePath } from "./app-settings/shared";
import type { AgentKey, AppSettingsNavItem, NavKey, NavSection } from "./app-settings/types";

const NAV_ITEMS: AppSettingsNavItem[] = [
  { key: "general", labelKey: "appSettings.general", section: "application", icon: SettingsIcon },
  { key: "fonts", labelKey: "appSettings.fonts", section: "application", icon: Type },
  { key: "shortcuts", labelKey: "appSettings.shortcuts", section: "application", icon: Keyboard },
  { key: "hooks", labelKey: "appSettings.hooks", section: "application", icon: Zap },
  {
    key: "claude",
    labelKey: "Claude Code",
    section: "agents",
    logo: claudeLogo,
    filePath: getAgentSettingsFilePath("claude"),
    lang: "json",
  },
  {
    key: "codex",
    labelKey: "Codex",
    section: "agents",
    logo: chatgptLogo,
    filePath: getAgentSettingsFilePath("codex"),
    lang: "toml",
  },
];

const SECTION_ORDER: NavSection[] = ["application", "agents"];

const SECTION_LABEL_KEY: Record<NavSection, string> = {
  application: "appSettings.section.application",
  agents: "appSettings.section.agents",
};

function NavItemIcon({ item, size }: { item: AppSettingsNavItem; size: number }) {
  if (item.logo) {
    return (
      <img
        src={item.logo}
        style={{ width: size, height: size, opacity: item.key === "codex" ? 0.7 : 1 }}
      />
    );
  }
  if (item.icon) {
    const Icon = item.icon;
    return (
      <Icon
        size={size}
        strokeWidth={1.8}
        color={item.iconColor ?? "var(--text-secondary)"}
        fill={item.iconFill ?? "none"}
      />
    );
  }
  return null;
}

export function AppSettingsDialog({
  onClose,
  terminalFontSize,
  onTerminalFontSizeChange,
  taskDisplayWindow,
  onTaskDisplayWindowChange,
  attentionBadge,
  onAttentionBadgeChange,
  terminalScrollback,
  onTerminalScrollbackChange,
  uiFontFamily,
  onUiFontFamilyChange,
  monoFontFamily,
  onMonoFontFamilyChange,
}: {
  onClose: () => void;
  terminalFontSize: TerminalFontSize;
  onTerminalFontSizeChange: (size: TerminalFontSize) => void;
  taskDisplayWindow: TaskDisplayWindow;
  onTaskDisplayWindowChange: (window: TaskDisplayWindow) => void;
  attentionBadge: boolean;
  onAttentionBadgeChange: (enabled: boolean) => void;
  terminalScrollback: TerminalScrollback;
  onTerminalScrollbackChange: (value: TerminalScrollback) => void;
  uiFontFamily: FontFamily;
  onUiFontFamilyChange: (family: FontFamily) => void;
  monoFontFamily: FontFamily;
  onMonoFontFamilyChange: (family: FontFamily) => void;
}) {
  const { t } = useI18n();
  const [activeNav, setActiveNav] = useState<NavKey>("general");

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const activeItem = NAV_ITEMS.find((n) => n.key === activeNav)!;
  const activeLabel = t(activeItem.labelKey);

  const sectionGroups = SECTION_ORDER.map((section) => ({
    section,
    items: NAV_ITEMS.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0);

  return (
    <div style={s.modalOverlay} onClick={handleOverlayClick}>
      <div style={s.modalBox}>
        <div style={s.settingsNav}>
          <div style={s.settingsNavTitle}>{t("appSettings.title")}</div>
          {sectionGroups.map((group, groupIndex) => (
            <Fragment key={group.section}>
              <div
                style={{
                  ...s.settingsNavSectionLabel,
                  ...(groupIndex === 0 ? s.settingsNavSectionLabelFirst : null),
                }}
              >
                {t(SECTION_LABEL_KEY[group.section])}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  style={{
                    ...s.settingsNavItem,
                    background: activeNav === item.key ? "var(--bg-hover)" : "none",
                    color: activeNav === item.key ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: activeNav === item.key ? 600 : 500,
                  }}
                  onClick={() => setActiveNav(item.key)}
                >
                  <NavItemIcon item={item} size={14} />
                  {t(item.labelKey)}
                </button>
              ))}
            </Fragment>
          ))}
        </div>

        <div style={s.settingsContent}>
          <div style={s.settingsContentHeader}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <NavItemIcon item={activeItem} size={16} />
              <span style={s.settingsContentTitle}>{activeLabel}</span>
            </div>
            <button style={s.modalCloseBtn} onClick={onClose} title={t("common.close")}>
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          {activeNav === "general" ? (
            <GeneralPanel
              key="general"
              taskDisplayWindow={taskDisplayWindow}
              onTaskDisplayWindowChange={onTaskDisplayWindowChange}
              attentionBadge={attentionBadge}
              onAttentionBadgeChange={onAttentionBadgeChange}
              terminalScrollback={terminalScrollback}
              onTerminalScrollbackChange={onTerminalScrollbackChange}
            />
          ) : activeNav === "fonts" ? (
            <FontPanel
              key="fonts"
              terminalFontSize={terminalFontSize}
              onTerminalFontSizeChange={onTerminalFontSizeChange}
              uiFontFamily={uiFontFamily}
              onUiFontFamilyChange={onUiFontFamilyChange}
              monoFontFamily={monoFontFamily}
              onMonoFontFamilyChange={onMonoFontFamilyChange}
            />
          ) : activeNav === "shortcuts" ? (
            <ShortcutsPanel key="shortcuts" />
          ) : activeNav === "hooks" ? (
            <HooksPanel key="hooks" />
          ) : (
            <AgentConfigPanel
              key={activeNav}
              agentKey={activeNav as AgentKey}
              filePath={activeItem.filePath!}
              lang={activeItem.lang!}
              themeVariant="dark"
            />
          )}
        </div>
      </div>
    </div>
  );
}
