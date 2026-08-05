import { useMemo } from "react";
import Icon from "../components/Icon";
import { useProjectStore } from "../stores/projectStore";
import {
  useLocalSessionStore,
  type LocalSessionStatus,
} from "./localSessionStore";
import styles from "./LocalSidebar.module.css";

export default function LocalSidebar() {
  const projects = useProjectStore((state) => state.projects);
  const activeProjectPath = useProjectStore((state) => state.activeProjectPath);
  const addProject = useProjectStore((state) => state.addProject);
  const selectProject = useProjectStore((state) => state.selectProject);
  const removeProject = useProjectStore((state) => state.removeProject);
  const allSessions = useLocalSessionStore((state) => state.sessions);
  const sessions = useMemo(
    () =>
      activeProjectPath
        ? allSessions
            .filter((session) => session.projectPath === activeProjectPath)
            .slice(0, 80)
        : [],
    [activeProjectPath, allSessions],
  );
  const activeTaskId = useLocalSessionStore((state) => state.activeTaskId);
  const selectSession = useLocalSessionStore((state) => state.selectSession);

  return (
    <section className={styles.sidebar} aria-label="本地开发项目">
      <div className="panel-header">
        <span className="panel-title">本地项目</span>
        <button
          type="button"
          className="icon-btn"
          title="添加项目目录"
          aria-label="添加项目目录"
          onClick={() => void addProject()}
        >
          <Icon name="add" size={16} />
        </button>
      </div>

      <div className={styles.projectList} role="list">
        {projects.length === 0 ? (
          <div className={styles.empty}>
            <Icon name="folder" size={20} />
            <span>还没有本地项目</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void addProject()}
            >
              添加项目目录
            </button>
          </div>
        ) : (
          projects.map((project) => {
            const active = project.path === activeProjectPath;
            return (
              <div
                key={project.id}
                role="listitem"
                className={styles.project + (active ? " " + styles.active : "")}
              >
                <button
                  type="button"
                  className={styles.projectButton}
                  title={project.path}
                  onClick={() => selectProject(project.path)}
                >
                  <Icon name="folder" size={16} />
                  <span className={styles.projectText}>
                    <strong>{project.name}</strong>
                    <small>{project.path}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.remove}
                  title={"移除 " + project.name}
                  aria-label={"移除 " + project.name}
                  onClick={() => removeProject(project.path)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className={styles.sessions}>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionTitle}>会话</div>
          {sessions.length > 0 && <span>{sessions.length}</span>}
        </div>
        {sessions.length === 0 ? (
          <div className={styles.sessionHint}>
            选择项目后，新建本地 agent 任务
          </div>
        ) : (
          <div className={styles.sessionList} role="list">
            {sessions.map((session) => (
              <button
                key={session.taskId}
                type="button"
                role="listitem"
                className={
                  styles.session +
                  (activeTaskId === session.taskId
                    ? " " + styles.sessionActive
                    : "")
                }
                onClick={() => selectSession(session.taskId)}
                title={session.title}
              >
                <span
                  className={styles.sessionDot}
                  data-status={session.status}
                />
                <span className={styles.sessionMain}>
                  <strong>{session.title}</strong>
                  <small>
                    {session.agent} · {statusLabel(session.status)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function statusLabel(status: LocalSessionStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已停止";
    default:
      return "历史";
  }
}
