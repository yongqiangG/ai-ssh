import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { AuthMethod, SshServer } from "../types";
import Icon from "./Icon";
import styles from "./ServerFormDialog.module.css";

export type { ServerFormInput } from "../stores/serversStore";

interface ServerFormDialogProps {
  open: boolean;
  /** 传入则为编辑模式，否则为新增 */
  initial?: SshServer | null;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    host: string;
    port: number;
    username: string;
    authMethod: AuthMethod;
    password?: string;
    privateKey?: string;
    group?: string;
  }) => void;
}

const EMPTY = {
  name: "",
  host: "",
  port: 22,
  username: "root",
  authMethod: "password" as AuthMethod,
  password: "",
  privateKey: "",
  group: "",
};

type FormState = typeof EMPTY;

export default function ServerFormDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: ServerFormDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      initial
        ? {
            name: initial.name,
            host: initial.host,
            port: initial.port,
            username: initial.username,
            authMethod: initial.authMethod,
            password: initial.password ?? "",
            privateKey: initial.privateKey ?? "",
            group: initial.group ?? "",
          }
        : EMPTY
    );
  }, [open, initial]);

  if (!open) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const host = form.host.trim();
    const username = form.username.trim();
    if (!name || !host || !username) {
      setError("名称、主机、用户名为必填项");
      return;
    }
    const port = Number(form.port) || 22;
    onSubmit({
      name,
      host,
      port,
      username,
      authMethod: form.authMethod,
      password: form.authMethod === "password" ? form.password : undefined,
      privateKey: form.authMethod === "key" ? form.privateKey : undefined,
      group: form.group.trim() || undefined,
    });
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
            {initial ? "编辑服务器" : "新增服务器"}
          </span>
          <button className="icon-btn" onClick={onClose} title="关闭" type="button">
            <Icon name="close" />
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <Field label="名称">
            <input
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="my-server"
              autoFocus
            />
          </Field>

          <div className={styles.row}>
            <Field label="主机" className={styles.grow}>
              <input
                className="input"
                value={form.host}
                onChange={(e) => set("host", e.target.value)}
                placeholder="192.168.1.10"
              />
            </Field>
            <Field label="端口">
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

          <Field label="用户名">
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
              value={form.authMethod}
              onChange={(e) => set("authMethod", e.target.value as AuthMethod)}
            >
              <option value="password">密码</option>
              <option value="key">私钥</option>
            </select>
          </Field>

          {form.authMethod === "password" ? (
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

          <Field label="分组（可选）">
            <input
              className="input"
              value={form.group}
              onChange={(e) => set("group", e.target.value)}
              placeholder="生产 / 测试"
            />
          </Field>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.footer}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn">
              {initial ? "保存" : "添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`${styles.field} ${className ?? ""}`}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}
