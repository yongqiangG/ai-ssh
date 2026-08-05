import { useState } from "react";
import type { ClipboardEvent, FormEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import Icon from "../components/Icon";
import type { LocalAgent, LocalPermissionMode } from "./localSessionStore";
import styles from "./NewTaskView.module.css";

const MAX_ATTACHMENTS = 32;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export interface NewTaskSubmit {
  prompt: string;
  agent: LocalAgent;
  permissionMode: LocalPermissionMode;
  fileRefs: string[];
  images: string[];
  texts: string[];
}

interface NewTaskViewProps {
  projectPath: string;
  onSubmit: (input: NewTaskSubmit) => void | Promise<void>;
}

interface TextAttachment {
  name: string;
  content: string;
}

interface ImageAttachment {
  name: string;
  dataUrl: string;
}

function normalizeComparablePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (normalized.length <= 3) return normalized;
  return normalized.replace(/\/+$/, "");
}

export function toProjectRelativePath(
  projectPath: string,
  filePath: string,
): string | null {
  const base = normalizeComparablePath(projectPath);
  const candidate = normalizeComparablePath(filePath);
  const isWindowsPath = /^[a-zA-Z]:\//.test(base) || base.startsWith("//");
  const comparableBase = isWindowsPath ? base.toLowerCase() : base;
  const comparableCandidate = isWindowsPath
    ? candidate.toLowerCase()
    : candidate;
  const prefix = base.endsWith("/") ? base : base + "/";
  const comparablePrefix = isWindowsPath ? prefix.toLowerCase() : prefix;

  if (!candidate || comparableCandidate === comparableBase) return null;
  if (!comparableCandidate.startsWith(comparablePrefix)) return null;
  return candidate.slice(prefix.length);
}

function selectedPaths(value: string | string[] | null): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function displayName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

function mimeType(path: string): string {
  const extension = path.toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  return "image/png";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("read image failed"));
    reader.readAsDataURL(file);
  });
}

export default function NewTaskView({
  projectPath,
  onSubmit,
}: NewTaskViewProps) {
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState<LocalAgent>("claude");
  const [permissionMode, setPermissionMode] =
    useState<LocalPermissionMode>("ask");
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [texts, setTexts] = useState<TextAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickProjectFiles = async () => {
    try {
      const selected = await openDialog({
        title: "选择项目内文件",
        defaultPath: projectPath,
        multiple: true,
        directory: false,
      });
      const paths = selectedPaths(selected);
      const refs = paths
        .map((path) => toProjectRelativePath(projectPath, path))
        .filter((path): path is string => Boolean(path));
      if (refs.length !== paths.length) {
        setError("只能引用当前项目目录内的文件");
      }
      setFileRefs((current) => [...new Set([...current, ...refs])]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const pickImages = async () => {
    try {
      const selected = await openDialog({
        title: "选择图片附件",
        defaultPath: projectPath,
        multiple: true,
        directory: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      const paths = selectedPaths(selected);
      if (images.length + paths.length > MAX_ATTACHMENTS) {
        setError("附件数量不能超过 32 个");
        return;
      }
      const loaded: ImageAttachment[] = [];
      for (const path of paths) {
        const bytes = await readFile(path);
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          setError(displayName(path) + " 超过 20MB，已跳过");
          continue;
        }
        loaded.push({
          name: displayName(path),
          dataUrl: "data:" + mimeType(path) + ";base64," + bytesToBase64(bytes),
        });
      }
      setImages((current) => [...current, ...loaded]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const pickTexts = async () => {
    try {
      const selected = await openDialog({
        title: "选择文本附件",
        defaultPath: projectPath,
        multiple: true,
        directory: false,
      });
      const paths = selectedPaths(selected);
      if (texts.length + paths.length > MAX_ATTACHMENTS) {
        setError("附件数量不能超过 32 个");
        return;
      }
      const loaded: TextAttachment[] = [];
      for (const path of paths) {
        const content = await readTextFile(path);
        if (new TextEncoder().encode(content).byteLength > MAX_TEXT_BYTES) {
          setError(displayName(path) + " 超过 5MB，已跳过");
          continue;
        }
        loaded.push({ name: displayName(path), content });
      }
      setTexts((current) => [...current, ...loaded]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addPastedImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (images.length >= MAX_ATTACHMENTS) {
      setError("附件数量不能超过 32 个");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("粘贴的图片超过 20MB");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setImages((current) => [
        ...current,
        { name: file.name || "pasted-image", dataUrl },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(event.clipboardData.files).find((file) =>
      file.type.startsWith("image/"),
    );
    if (!image) return;
    event.preventDefault();
    void addPastedImage(image);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (
      !trimmedPrompt &&
      fileRefs.length === 0 &&
      images.length === 0 &&
      texts.length === 0
    ) {
      setError("请输入任务描述，或添加至少一个附件");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        prompt: trimmedPrompt,
        agent,
        permissionMode,
        fileRefs,
        images: images.map((item) => item.dataUrl),
        texts: texts.map((item) => item.content),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formHeader}>
        <div>
          <div className={styles.eyebrow}>NEW LOCAL TASK</div>
          <h2>创建本地 agent 任务</h2>
        </div>
        <code title={projectPath}>{projectPath}</code>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>任务描述</span>
        <textarea
          className="textarea"
          rows={8}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onPaste={handlePaste}
          placeholder="描述要完成的工作，也可以直接输入 @文件路径 引用项目文件"
          autoFocus
        />
      </label>

      <div className={styles.row}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>Agent</legend>
          <div className={styles.choiceRow}>
            {(["claude", "codex"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={
                  styles.choice +
                  (agent === item ? " " + styles.choiceActive : "")
                }
                aria-pressed={agent === item}
                onClick={() => setAgent(item)}
              >
                <Icon name="bot" size={15} />
                {item === "claude" ? "Claude Code" : "Codex"}
              </button>
            ))}
          </div>
        </fieldset>

        <label className={styles.field + " " + styles.permission}>
          <span className={styles.label}>权限模式</span>
          <select
            className="select"
            value={permissionMode}
            onChange={(event) =>
              setPermissionMode(event.target.value as LocalPermissionMode)
            }
          >
            <option value="ask">询问后执行</option>
            <option value="auto_edit">自动应用编辑</option>
            <option value="full_access">完全访问（高风险）</option>
          </select>
        </label>
      </div>

      <div className={styles.tools}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void pickProjectFiles()}
        >
          <Icon name="file" size={14} /> @ 引用项目文件
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void pickImages()}
        >
          <Icon name="openFile" size={14} /> 添加图片
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void pickTexts()}
        >
          <Icon name="file" size={14} /> 添加文本
        </button>
      </div>

      {(fileRefs.length > 0 || images.length > 0 || texts.length > 0) && (
        <div className={styles.attachments} aria-label="已添加附件">
          {fileRefs.map((path) => (
            <AttachmentChip
              key={"ref:" + path}
              label={"@" + path}
              onRemove={() =>
                setFileRefs((current) =>
                  current.filter((item) => item !== path),
                )
              }
            />
          ))}
          {images.map((image, index) => (
            <AttachmentChip
              key={"image:" + image.name + index}
              label={image.name}
              preview={image.dataUrl}
              onRemove={() =>
                setImages((current) =>
                  current.filter((_, item) => item !== index),
                )
              }
            />
          ))}
          {texts.map((text, index) => (
            <AttachmentChip
              key={"text:" + text.name + index}
              label={text.name}
              onRemove={() =>
                setTexts((current) =>
                  current.filter((_, item) => item !== index),
                )
              }
            />
          ))}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.footer}>
        <span className={styles.hint}>
          终端启动后仍可在 PTY 内切换模型或继续交互。
        </span>
        <button type="submit" className="btn" disabled={submitting}>
          <Icon name="play" size={14} />
          {submitting ? "启动中…" : "启动任务"}
        </button>
      </div>
    </form>
  );
}

function AttachmentChip({
  label,
  preview,
  onRemove,
}: {
  label: string;
  preview?: string;
  onRemove: () => void;
}) {
  return (
    <span className={styles.attachment}>
      {preview && <img src={preview} alt="" />}
      <span title={label}>{label}</span>
      <button type="button" aria-label={"移除 " + label} onClick={onRemove}>
        <Icon name="close" size={12} />
      </button>
    </span>
  );
}
