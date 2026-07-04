import { useEffect, useState } from "react";
import Icon from "./Icon";
import { getBaseUrl, setBaseUrl } from "../api/request";
import modalStyles from "./sshConnectionModal.module.css";

interface BackendSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 后端服务地址设置。
 * 开发环境留空走 vite 代理；生产环境填写实际地址（如 http://192.168.1.10:8091）。
 * 修改后立即持久化到 localStorage。
 */
export default function BackendSettingsModal({
  open,
  onClose,
}: BackendSettingsModalProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (open) setUrl(getBaseUrl());
  }, [open]);

  if (!open) return null;

  const save = () => {
    setBaseUrl(url);
    onClose();
  };

  return (
    <div className={modalStyles.overlay} onMouseDown={onClose}>
      <div
        className={modalStyles.dialog}
        style={{ width: 420 }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={modalStyles.header}>
          <span className={modalStyles.headerTitle}>后端服务地址</span>
          <button className="icon-btn" onClick={onClose} title="关闭" type="button">
            <Icon name="close" />
          </button>
        </div>
        <div className={modalStyles.body}>
          <label className={modalStyles.field}>
            <span className={modalStyles.label}>服务地址</span>
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="留空走开发代理；生产填 http://host:8091"
              autoFocus
            />
          </label>
          <div className={modalStyles.hint}>
            开发环境留空即可（vite 代理 /api → localhost:8091）；生产环境填写后端实际地址，保存后即时生效并持久化。
          </div>
        </div>
        <div className={modalStyles.footer}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            取消
          </button>
          <button type="button" className="btn" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
