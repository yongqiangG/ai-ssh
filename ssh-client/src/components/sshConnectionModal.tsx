import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Icon from "./Icon";
import styles from "./sshConnectionModal.module.css";
import type { AuthType, SshConnection, SshConnectionPayload } from "../api/sshConnection";
import { useConnectionStore } from "../stores/connectionStore";

export type SshConnectionModalMode = "create" | "edit";

interface SshConnectionModalProps {
  open: boolean;
  mode: SshConnectionModalMode;
  /** 编辑模式下的原始连接 */
  initial?: SshConnection | null;
  onClose: () => void;
}

type TabKey = "basic" | "auth" | "advanced";

interface FormState {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password: string;
  privateKey: string;
  connectTimeout: number;
  keepaliveInterval: number;
  startupCommand: string;
  compression: boolean;
  strictHostKeyCheck: boolean;
}

const DEFAULTS: FormState = {
  name: "",
  host: "",
  port: 22,
  username: "root",
  authType: "PASSWORD",
  password: "",
  privateKey: "",
  connectTimeout: 5000,
  keepaliveInterval: 30000,
  startupCommand: "",
  compression: false,
  strictHostKeyCheck: false,
};

function fromConnection(c: SshConnection): FormState {
  return {
    name: c.name,
    host: c.host,
    port: c.port,
    username: c.username,
    authType: c.authType,
    password: c.password ?? "",
    privateKey: c.privateKey ?? "",
    connectTimeout: c.connectTimeout,
    keepaliveInterval: c.keepaliveInterval,
    startupCommand: c.startupCommand ?? "",
    compression: c.compression,
    strictHostKeyCheck: c.strictHostKeyCheck,
  };
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "basic", label: "基本信息" },
  { key: "auth", label: "认证" },
  { key: "advanced", label: "高级选项" },
];

export default function SshConnectionModal({
  open,
  mode,
  initial,
  onClose,
}: SshConnectionModalProps) {
  const create = useConnectionStore((s) => s.create);
  const update = useConnectionStore((s) => s.update);
  const [tab, setTab] = useState<TabKey>("basic");
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("basic");
    setError(null);
    setForm(initial ? fromConnection(initial) : DEFAULTS);
  }, [open, initial]);

  if (!open) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const host = form.host.trim();
    const username = form.username.trim();
    if (!name || !host || !username) {
      setError("连接名称、主机地址、用户名为必填项");
      setTab("basic");
      return;
    }
    if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
      setError("端口必须为 1-65535 的整数");
      setTab("basic");
      return;
    }

    const payload: SshConnectionPayload = {
      name,
      host,
      port: form.port,
      username,
      authType: form.authType,
      password: form.authType === "PASSWORD" ? form.password : undefined,
      privateKey: form.authType === "PUBLIC_KEY" ? form.privateKey : undefined,
      connectTimeout: form.connectTimeout,
      keepaliveInterval: form.keepaliveInterval,
      startupCommand: form.startupCommand.trim(),
      compression: form.compression,
      strictHostKeyCheck: form.strictHostKeyCheck,
    };

    setSubmitting(true);
    setError(null);
    try {
      if (mode === "create") {
        await create(payload);
      } else if (initial) {
        await update(initial.connectionId, payload);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        className={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            {mode === "create" ? "新建连接" : "编辑连接"}
          </span>
          <button className="icon-btn" onClick={onClose} title="关闭" type="button">
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${styles.tab} ${tab === t.key ? styles.active : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          {tab === "basic" && (
            <>
              <Field label="连接名称" required>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="my-server"
                  autoFocus
                />
              </Field>
              <div className={styles.row}>
                <Field label="主机地址" required className={styles.grow}>
                  <input
                    className="input"
                    value={form.host}
                    onChange={(e) => set("host", e.target.value)}
                    placeholder="192.168.1.10"
                  />
                </Field>
                <Field label="端口" required>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => set("port", Number(e.target.value))}
                  />
                </Field>
              </div>
            </>
          )}

          {tab === "auth" && (
            <>
              <Field label="用户名" required>
                <input
                  className="input"
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                  placeholder="root"
                />
              </Field>
              <Field label="认证方式">
                <select
                  className="select"
                  value={form.authType}
                  onChange={(e) => set("authType", e.target.value as AuthType)}
                >
                  <option value="PASSWORD">密码</option>
                  <option value="PUBLIC_KEY">私钥</option>
                </select>
              </Field>
              {form.authType === "PASSWORD" ? (
                <Field label="密码">
                  <input
                    className="input"
                    type="password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder="••••••"
                  />
                </Field>
              ) : (
                <Field label="私钥">
                  <textarea
                    className="textarea"
                    rows={4}
                    value={form.privateKey}
                    onChange={(e) => set("privateKey", e.target.value)}
                    placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----"}
                  />
                </Field>
              )}
            </>
          )}

          {tab === "advanced" && (
            <>
              <div className={styles.row}>
                <Field label="连接超时(ms)" className={styles.grow}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={form.connectTimeout}
                    onChange={(e) =>
                      set("connectTimeout", Number(e.target.value))
                    }
                  />
                </Field>
                <Field label="保活间隔(ms)" className={styles.grow}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={form.keepaliveInterval}
                    onChange={(e) =>
                      set("keepaliveInterval", Number(e.target.value))
                    }
                  />
                </Field>
              </div>
              <Field label="启动命令">
                <input
                  className="input"
                  value={form.startupCommand}
                  onChange={(e) => set("startupCommand", e.target.value)}
                  placeholder="连接后执行的命令（可选）"
                />
              </Field>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={form.compression}
                  onChange={(e) => set("compression", e.target.checked)}
                />
                <span className={styles.label}>启用压缩</span>
              </label>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={form.strictHostKeyCheck}
                  onChange={(e) => set("strictHostKeyCheck", e.target.checked)}
                />
                <span className={styles.label}>严格主机密钥检查</span>
              </label>
              <div className={styles.hint}>
                高级选项留空或不填时，由服务端填充默认值（超时 5000ms、保活 30000ms）。
              </div>
            </>
          )}

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.footer}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              取消
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              {mode === "create" ? "创建" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`${styles.field} ${className ?? ""}`}>
      <span className={styles.label}>
        {label}
        {required && <span className={styles.required}>*</span>}
      </span>
      {children}
    </label>
  );
}
