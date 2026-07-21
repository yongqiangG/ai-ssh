import { useState } from "react";
import { useConnectionStore } from "../stores/connectionStore";
import styles from "./HostKeyConfirmModal.module.css";

/**
 * TOFU 主机指纹确认弹窗（由 connectionStore.pendingHostKey 驱动）。
 * UNKNOWN：首次连接确认卡；CHANGED：红色警告 + 二次确认（疑似服务器重装或中间人攻击）。
 */
export default function HostKeyConfirmModal() {
  const pending = useConnectionStore((s) => s.pendingHostKey);
  const accept = useConnectionStore((s) => s.acceptPendingHostKey);
  const reject = useConnectionStore((s) => s.rejectPendingHostKey);
  const connections = useConnectionStore((s) => s.connections);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pending) return null;
  const { result } = pending;
  const changed = result.hostKeyStatus === "CHANGED";
  const connName =
    connections.find((c) => c.connectionId === pending.connectionId)?.name ??
    pending.connectionId;

  const handleAccept = async () => {
    if (
      changed &&
      !window.confirm(
        "再次确认：只有当你明确知道服务器为何更换了密钥（如重装系统）时才应继续。\n确定信任新指纹？"
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await accept();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div
        className={`${styles.dialog} ${changed ? styles.danger : ""}`}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.title}>
          {changed ? "⚠️ 主机指纹已改变！" : "确认主机指纹"}
        </div>
        <div className={styles.body}>
          {changed ? (
            <p className={styles.warnText}>
              连接「{connName}」的服务器返回了与已知记录<b>不一致</b>的密钥指纹。
              这可能是服务器重装了系统——但也可能是<b>中间人攻击</b>。
              在不确定原因前，请勿信任。
            </p>
          ) : (
            <p>
              首次连接「{connName}」，无法验证服务器身份。请与服务器管理员核对以下指纹后再信任
              （之后指纹变化会收到警告）。
            </p>
          )}
          <div className={styles.fpBox}>
            <div className={styles.fpRow}>
              <span className={styles.fpLabel}>主机</span>
              <code>{result.host}</code>
            </div>
            <div className={styles.fpRow}>
              <span className={styles.fpLabel}>算法</span>
              <code>{result.keyType}</code>
            </div>
            {changed && result.oldFingerprintSha256 && (
              <div className={styles.fpRow}>
                <span className={styles.fpLabel}>旧指纹</span>
                <code className={styles.oldFp}>{result.oldFingerprintSha256}</code>
              </div>
            )}
            <div className={styles.fpRow}>
              <span className={styles.fpLabel}>{changed ? "新指纹" : "指纹"}</span>
              <code className={changed ? styles.newFp : undefined}>
                {result.fingerprintSha256}
              </code>
            </div>
          </div>
          {error && <div className={styles.error}>{error}</div>}
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={reject}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className={`btn ${changed ? styles.dangerBtn : ""}`}
            onClick={handleAccept}
            disabled={busy}
          >
            {busy ? "连接中…" : changed ? "我了解风险，信任新指纹" : "信任并连接"}
          </button>
        </div>
      </div>
    </div>
  );
}
