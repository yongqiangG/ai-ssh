import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import type {
  TerminalFontSize,
  TerminalScrollback,
  TaskDisplayWindow,
  FontFamily,
} from "../types";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { OPEN_APP_SETTINGS_EVENT } from "./app-settings/types";
import { useI18n } from "../i18n";
import s from "../styles";

export function SidebarFooterActions({
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
  const [showAppSettings, setShowAppSettings] = useState(false);

  useEffect(() => {
    const open = () => setShowAppSettings(true);
    window.addEventListener(OPEN_APP_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_APP_SETTINGS_EVENT, open);
  }, []);

  return (
    <>
      <div style={s.sidebarFooterActions}>
        <button
          style={s.sidebarIconBtn}
          title={t("appSettings.title")}
          onClick={() => setShowAppSettings(true)}
        >
          <Settings size={14} strokeWidth={1.6} color="var(--text-hint)" />
        </button>
      </div>

      {showAppSettings && (
        <AppSettingsDialog
          terminalFontSize={terminalFontSize}
          onTerminalFontSizeChange={onTerminalFontSizeChange}
          taskDisplayWindow={taskDisplayWindow}
          onTaskDisplayWindowChange={onTaskDisplayWindowChange}
          attentionBadge={attentionBadge}
          onAttentionBadgeChange={onAttentionBadgeChange}
          terminalScrollback={terminalScrollback}
          onTerminalScrollbackChange={onTerminalScrollbackChange}
          uiFontFamily={uiFontFamily}
          onUiFontFamilyChange={onUiFontFamilyChange}
          monoFontFamily={monoFontFamily}
          onMonoFontFamilyChange={onMonoFontFamilyChange}
          onClose={() => setShowAppSettings(false)}
        />
      )}
    </>
  );
}
