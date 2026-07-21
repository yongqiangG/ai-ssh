import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Icon from "./Icon";
import styles from "./sshConnectionModal.module.css";
import type { AuthType, SshConnection, SshConnectionPayload } from "../api/sshConnection";
import { createKey, listKeys } from "../api/sshKey";
import type { SshKeyDTO } from "../api/sshKey";
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
  /** 引用的密钥 keyId（PUBLIC_KEY 认证）；私钥内容经密钥实体管理，不再内嵌 */
  keyId: string;
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
  keyId: "",
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
    // 凭据不回显：密码留空表示「保持不变」（占位符提示），密钥经 keyId 引用回显
    password: "",
    keyId: c.keyId ?? "",
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
  // 密钥下拉数据源与内联新建区状态（密钥管理 v1 内嵌于表单，不做独立面板）
  const [keys, setKeys] = useState<SshKeyDTO[]>([]);
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKey, setNewKey] = useState({ name: "", privateKey: "", passphrase: "" });
  const [creatingKey, setCreatingKey] = useState(false);

  const loadKeys = async () => {
    try {
      setKeys(await listKeys());
    } catch {
      // 列表加载失败不阻塞表单；下拉空时用户仍可新建密钥触发重载
    }
  };

  useEffect(() => {
    if (!open) return;
    setTab("basic");
    setError(null);
    setShowNewKey(false);
    setNewKey({ name: "", privateKey: "", passphrase: "" });
    setForm(initial ? fromConnection(initial) : DEFAULTS);
    void loadKeys();
  }, [open, initial]);

  if (!open) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** 桌面版专属：dialog 选私钥文件 → 读内容填入新建区（仍存内容不存路径） */
  const pickKeyFile = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ multiple: false, title: "选择私钥文件" });
      if (!selected || typeof selected !== "string") return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const content = await readTextFile(selected);
      setNewKey((k) => ({
        ...k,
        privateKey: content,
        name: k.name || selected.replace(/\\/g, "/").split("/").pop() || "",
      }));
    } catch (err) {
      setError(
        "读取私钥文件失败（浏览器模式或受保护目录）；请直接粘贴私钥内容。" +
          (err instanceof Error ? ` ${err.message}` : "")
      );
    }
  };

  const handleCreateKey = async () => {
    const name = newKey.name.trim();
    const privateKey = newKey.privateKey.trim();
    if (!name || !privateKey) {
      setError("密钥名称与私钥内容为必填项");
      return;
    }
    setCreatingKey(true);
    setError(null);
    try {
      const keyId = await createKey({
        name,
        privateKey,
        passphrase: newKey.passphrase || undefined,
      });
      await loadKeys();
      set("keyId", keyId);
      setShowNewKey(false);
      setNewKey({ name: "", privateKey: "", passphrase: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingKey(false);
    }
  };

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
    if (form.authType === "PASSWORD" && mode === "create" && !form.password) {
      setError("密码认证方式下密码不能为空");
      setTab("auth");
      return;
    }
    if (form.authType === "PUBLIC_KEY" && !form.keyId) {
      setError("请选择密钥（或新建一个）");
      setTab("auth");
      return;
    }

    const payload: SshConnectionPayload = {
      name,
      host,
      port: form.port,
      username,
      authType: form.authType,
      // 留空不改：空字符串不提交（编辑态密码留空 = 保持原密码）
      password:
        form.authType === "PASSWORD" && form.password ? form.password : undefined,
      keyId: form.authType === "PUBLIC_KEY" ? form.keyId : undefined,
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
                    placeholder={
                      mode === "edit" && initial?.passwordConfigured
                        ? "已配置，留空保持不变"
                        : "••••••"
                    }
                  />
                </Field>
              ) : (
                <>
                  <Field label="密钥">
                    <select
                      className="select"
                      value={form.keyId}
                      onChange={(e) => set("keyId", e.target.value)}
                    >
                      <option value="">选择密钥…</option>
                      {keys.map((k) => (
                        <option key={k.keyId} value={k.keyId}>
                          {k.name}
                          {k.passphraseConfigured ? "（带口令）" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowNewKey((v) => !v)}
                  >
                    {showNewKey ? "收起新建密钥" : "＋ 新建密钥"}
                  </button>
                  {showNewKey && (
                    <div className={styles.newKeyBox}>
                      <Field label="密钥名称" required>
                        <input
                          className="input"
                          value={newKey.name}
                          onChange={(e) =>
                            setNewKey((k) => ({ ...k, name: e.target.value }))
                          }
                          placeholder="如 id_ed25519 / 生产环境密钥"
                        />
                      </Field>
                      <Field label="私钥内容" required>
                        <textarea
                          className="textarea"
                          rows={4}
                          value={newKey.privateKey}
                          onChange={(e) =>
                            setNewKey((k) => ({ ...k, privateKey: e.target.value }))
                          }
                          placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----"}
                        />
                      </Field>
                      <div className={styles.row}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={pickKeyFile}
                        >
                          从文件导入…
                        </button>
                        <Field label="私钥口令（可选）" className={styles.grow}>
                          <input
                            className="input"
                            type="password"
                            value={newKey.passphrase}
                            onChange={(e) =>
                              setNewKey((k) => ({ ...k, passphrase: e.target.value }))
                            }
                            placeholder="无口令留空"
                          />
                        </Field>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={handleCreateKey}
                        disabled={creatingKey}
                      >
                        {creatingKey ? "保存中…" : "保存密钥"}
                      </button>
                    </div>
                  )}
                </>
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
