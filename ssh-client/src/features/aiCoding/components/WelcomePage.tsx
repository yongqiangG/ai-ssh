import { useState, useMemo } from "react";
import { Search, FolderOpen, Layers, Plus } from "lucide-react";
import type {
  Project,
  TerminalFontSize,
  TerminalScrollback,
  TaskDisplayWindow,
  FontFamily,
} from "../types";
import type { ProjectRenameResult } from "../projectName";
import { SidebarFooterActions } from "./SidebarFooterActions";
import { ProjectListItem } from "./welcome/ProjectListItem";
import { useI18n, pluralKey } from "../i18n";
import s from "../styles";

function WelcomeEmpty({ hasProjects, onOpen }: { hasProjects: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <div style={s.emptyState}>
      <div className="welcome-empty-icon">
        <FolderOpen size={40} strokeWidth={1.2} color="var(--text-hint)" />
      </div>
      <div className="welcome-empty-title">
        {hasProjects ? t("welcome.noMatchingProjects") : t("welcome.noProjectsYet")}
      </div>
      {!hasProjects && (
        <>
          <div className="welcome-empty-description">{t("welcome.openLocalRepo")}</div>
          <button style={s.emptyOpenBtn} onClick={onOpen}>
            <FolderOpen size={14} strokeWidth={2} />
            {t("welcome.openProjectFolder")}
          </button>
        </>
      )}
    </div>
  );
}

export function WelcomePage({
  projects,
  onOpen,
  onProjectClick,
  onDeleteProject,
  onToggleProjectHidden,
  onRenameProject,
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
  projects: Project[];
  onOpen: () => void;
  onProjectClick: (p: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onToggleProjectHidden: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => Promise<ProjectRenameResult>;
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
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <div style={s.welcomeBody}>
      <div style={s.welcomeMain}>
        <div style={s.sidebar}>
          <div style={s.sidebarBrand}>
            <div style={s.sidebarBrandIcon}>
              <span style={s.sidebarBrandBadge}>AI</span>
            </div>
            <div>
              <div style={s.sidebarBrandTitle}>AI Coding</div>
              <div style={s.sidebarBrandMeta}>{t("welcome.agentWorkspace")}</div>
            </div>
          </div>

          <nav style={s.sidebarNav}>
            <div style={s.sidebarSectionTitle}>{t("welcome.workspace")}</div>
            <button
              type="button"
              className="welcome-sidebar-item"
              data-active={true}
              onClick={() => setQuery("")}
            >
              <span className="welcome-sidebar-item-icon">
                <Layers size={15} />
              </span>
              <span className="welcome-sidebar-item-label">{t("welcome.projects")}</span>
            </button>
          </nav>

          <div style={s.sidebarFooter}>
            <SidebarFooterActions
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
            />
          </div>
        </div>

        <div style={s.welcomePane}>
          <div style={s.searchRow}>
            <div className="welcome-search-box">
              <Search
                size={15}
                strokeWidth={1.9}
                color="var(--text-muted)"
                className="welcome-search-icon"
              />
              <input
                style={s.searchInput}
                placeholder={t("welcome.searchProjects")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>

            <div style={s.actionRow}>
              <button style={s.primaryActionBtn} onClick={onOpen}>
                <Plus size={14} strokeWidth={2.3} />
                <span>{t("welcome.openProject")}</span>
              </button>
            </div>
          </div>

          <div style={s.projectSectionHeader}>
            <div>
              <div style={s.projectSectionTitle}>{t("welcome.projects")}</div>
              <div style={s.projectSectionCaption}>
                {query.trim()
                  ? t(
                      pluralKey(
                        "welcome.resultCount",
                        "welcome.resultCountPlural",
                        filtered.length,
                      ),
                      {
                        count: filtered.length,
                      },
                    )
                  : t(
                      pluralKey(
                        "welcome.projectCount",
                        "welcome.projectCountPlural",
                        projects.length,
                      ),
                      {
                        count: projects.length,
                      },
                    )}
              </div>
            </div>
          </div>

          <div style={s.projectList}>
            {filtered.length === 0 ? (
              <WelcomeEmpty hasProjects={projects.length > 0} onOpen={onOpen} />
            ) : (
              filtered.map((project) => (
                <ProjectListItem
                  key={project.id}
                  project={project}
                  onOpen={() => onProjectClick(project)}
                  onDelete={() => onDeleteProject(project.id)}
                  onToggleHidden={() => onToggleProjectHidden(project.id)}
                  onRename={(name) => onRenameProject(project.id, name)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
