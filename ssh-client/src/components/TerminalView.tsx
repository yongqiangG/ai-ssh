import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import styles from "./TerminalView.module.css";

export default function TerminalView() {
  const lines = useTerminalStore((s) => s.lines);
  const connection = useTerminalStore((s) => s.connection);
  const connectedServer = useTerminalStore((s) => s.connectedServer);
  const exec = useTerminalStore((s) => s.exec);

  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    exec(value);
    setValue("");
  };

  const prompt = `${connectedServer?.username ?? "user"}@${
    connectedServer?.host ?? "localhost"
  }:~$`;

  return (
    <div className={styles.terminal}>
      <div className={styles.output}>
        {lines.map((l) => (
          <div
            key={l.id}
            className={`${styles.line} ${styles[l.kind] ?? ""}`}
          >
            {l.text ? l.text : " "}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {connection === "connected" && (
        <form className={styles.inputRow} onSubmit={submit}>
          <span className={styles.prompt}>{prompt}</span>
          <input
            className={styles.input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="终端输入"
          />
        </form>
      )}
    </div>
  );
}
