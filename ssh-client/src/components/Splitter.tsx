import type { PointerEvent as ReactPointerEvent } from "react";
import styles from "./Splitter.module.css";

interface SplitterProps {
  /** 拖动过程中持续回调，deltaX 为相对上一次的水平位移（px） */
  onDrag: (deltaX: number) => void;
}

/**
 * 垂直可拖拽分隔条。监听 document 级 pointer 事件，
 * 在拖动期间禁用选中文本并切换光标。
 */
export default function Splitter({ onDrag }: SplitterProps) {
  const handleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    let lastX = e.clientX;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      if (dx !== 0) onDrag(dx);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      className={styles.splitter}
      onPointerDown={handleDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
