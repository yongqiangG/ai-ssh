import modalStyles from "./sshConnectionModal.module.css";

interface ConfirmDialogProps {
  message: string;
  kind?: "warning" | "info";
  /** warning: true=确认覆盖 / false=取消；info: 恒 false（仅关闭） */
  onResolve: (ok: boolean) => void;
}

/**
 * 应用内确认/提示弹窗（主题统一，替代 OS 原生 dialog 的 ask/message）。
 * 复用 sshConnectionModal.module.css 的遮罩/对话框/页脚样式，与全局弹窗视觉一致。
 * - warning：双按钮「否 / 覆盖」，用于覆盖确认；点遮罩=取消
 * - info：单按钮「知道了」，用于文件夹不支持等提示
 */
export default function ConfirmDialog({
  message,
  kind = "warning",
  onResolve,
}: ConfirmDialogProps) {
  const isWarn = kind === "warning";
  return (
    <div className={modalStyles.overlay} onMouseDown={() => onResolve(false)}>
      <div
        className={modalStyles.dialog}
        style={{ width: 360 }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div
          className={modalStyles.body}
          style={{
            textAlign: "center",
            padding: "22px 20px 16px",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--vsc-fg)",
          }}
        >
          {message}
        </div>
        <div className={modalStyles.footer}>
          {isWarn && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onResolve(false)}
            >
              否
            </button>
          )}
          <button
            type="button"
            className={isWarn ? "btn" : "btn btn-secondary"}
            onClick={() => onResolve(isWarn)}
          >
            {isWarn ? "覆盖" : "知道了"}
          </button>
        </div>
      </div>
    </div>
  );
}
