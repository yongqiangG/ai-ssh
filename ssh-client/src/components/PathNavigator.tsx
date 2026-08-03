import { type FormEvent, useEffect, useState } from "react";
import Icon from "./Icon";
import styles from "./PathNavigator.module.css";

export interface Crumb {
  label: string;
  path: string;
}

export type NavigatePath = (path: string) => Promise<boolean> | boolean;

interface PathNavigatorProps {
  title: string;
  side: "local" | "remote";
  cwd: string;
  parentPath: string;
  crumbs: Crumb[];
  drives?: string[];
  loading: boolean;
  error: string | null;
  onNavigate: NavigatePath;
}

function isDriveRoot(path: string): boolean {
  return /^[a-zA-Z]:\\$/.test(path);
}

export default function PathNavigator({
  title,
  side,
  cwd,
  parentPath,
  crumbs,
  drives = [],
  loading,
  error,
  onNavigate,
}: PathNavigatorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cwd);
  const root = crumbs[0];
  const driveOptions = Array.from(
    new Set(
      [root?.path, ...drives].filter(
        (path): path is string => !!path && isDriveRoot(path),
      ),
    ),
  );

  useEffect(() => {
    if (!editing) setDraft(cwd);
  }, [cwd, editing]);

  const startEditing = () => {
    setDraft(cwd);
    setEditing(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const path = draft.trim();
    if (!path) return;
    const ok = await onNavigate(path);
    if (ok) setEditing(false);
  };

  const navigate = (path: string) => {
    void onNavigate(path);
  };

  return (
    <div className={styles.navigator}>
      <div className={styles.row}>
        <button
          type="button"
          className="icon-btn"
          aria-label={`返回上一级${title}`}
          title="返回上一级"
          disabled={loading || parentPath === cwd}
          onClick={() => navigate(parentPath)}
        >
          <Icon name="chevronUp" size={13} />
        </button>

        {editing ? (
          <form className={styles.editForm} onSubmit={submit}>
            <input
              className={styles.pathInput}
              aria-label={`输入${title}路径`}
              value={draft}
              disabled={loading}
              autoFocus
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
              }}
            />
            <button
              type="submit"
              className="icon-btn"
              aria-label="跳转"
              title="跳转"
              disabled={loading || !draft.trim()}
            >
              <Icon name="check" size={13} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="取消编辑路径"
              title="取消"
              onClick={() => setEditing(false)}
            >
              <Icon name="close" size={13} />
            </button>
          </form>
        ) : (
          <div className={styles.crumbs} aria-label={`${title}路径导航`}>
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.path}-${index}`} className={styles.crumbItem}>
                {index > 0 && <span className={styles.sep}>›</span>}
                {index === 0 && side === "local" && driveOptions.length > 0 ? (
                  <select
                    className={styles.driveSelect}
                    aria-label="本地磁盘"
                    value={root?.path}
                    disabled={loading}
                    onChange={(event) => navigate(event.target.value)}
                  >
                    {driveOptions.map((drive) => (
                      <option key={drive} value={drive}>
                        {drive}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className={styles.crumbBtn}
                    onClick={() => navigate(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {!editing && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`编辑${title}路径`}
            title="编辑路径"
            disabled={loading}
            onClick={startEditing}
          >
            <Icon name="edit" size={12} />
          </button>
        )}
      </div>
      {error && (
        <div className={styles.error} role="alert" title={error}>
          {error}
        </div>
      )}
    </div>
  );
}
