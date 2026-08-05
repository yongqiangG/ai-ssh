import { create } from "zustand";
import { persist } from "zustand/middleware";
import { open as openDirectory } from "@tauri-apps/plugin-dialog";

export interface LocalProject {
  id: string;
  path: string;
  name: string;
  lastUsedAt: number;
}

interface ProjectState {
  projects: LocalProject[];
  activeProjectPath: string | null;
  addProject: (path?: string) => Promise<LocalProject | null>;
  selectProject: (path: string) => void;
  removeProject: (path: string) => void;
}

function normalizePath(path: string): string {
  const value = path.trim();
  if (value.length <= 3) return value;
  return value.replace(/[\\/]+$/, "");
}

function projectId(path: string): string {
  const normalized = normalizePath(path);
  return /^[a-zA-Z]:|^\\\\/.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function projectName(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function sortProjects(projects: LocalProject[]): LocalProject[] {
  return [...projects].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectPath: null,

      addProject: async (path) => {
        const selected = path ?? (await openDirectory({ directory: true }));
        const chosen = Array.isArray(selected) ? selected[0] : selected;
        if (!chosen) return null;

        const normalized = normalizePath(chosen);
        if (!normalized) return null;
        const id = projectId(normalized);
        const now = Date.now();
        const existing = get().projects.find((project) => project.id === id);
        const project: LocalProject = existing
          ? { ...existing, path: normalized, lastUsedAt: now }
          : {
              id,
              path: normalized,
              name: projectName(normalized),
              lastUsedAt: now,
            };
        set((state) => ({
          projects: sortProjects([
            ...state.projects.filter((item) => item.id !== id),
            project,
          ]),
          activeProjectPath: normalized,
        }));
        return project;
      },

      selectProject: (path) => {
        const normalized = normalizePath(path);
        const id = projectId(normalized);
        set((state) => {
          const selected = state.projects.find((project) => project.id === id);
          if (!selected) return { activeProjectPath: normalized };
          return {
            projects: sortProjects(
              state.projects.map((project) =>
                project.id === id
                  ? { ...project, lastUsedAt: Date.now() }
                  : project,
              ),
            ),
            activeProjectPath: selected.path,
          };
        });
      },

      removeProject: (path) => {
        const id = projectId(path);
        set((state) => {
          const projects = state.projects.filter((project) => project.id !== id);
          const active = state.activeProjectPath;
          const removedActive = active ? projectId(active) === id : false;
          return {
            projects,
            activeProjectPath: removedActive
              ? (projects[0]?.path ?? null)
              : active,
          };
        });
      },
    }),
    {
      name: "ai-ssh:local-projects",
      partialize: (state) => ({ projects: state.projects }),
    },
  ),
);

export { normalizePath as normalizeLocalProjectPath, projectName };
