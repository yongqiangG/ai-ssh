/**
 * 打字电火花（chat 输入框专属，决议：终端视口零特效不加）。
 *
 * 「打字 = 向电路注入能量」：每次录入在光标处溅出微小火花（volt/circuit），
 * 删除则溅暗色灰烬向下坠。坐标用镜像 div 技法从 textarea 反推光标像素位置；
 * 粒子走 WAAPI + transform/opacity（合成器友好），设并发上限防按住连发刷屏。
 * prefers-reduced-motion 或无 WAAPI（jsdom）时整体静默——纯装饰，绝不影响输入。
 */

const MAX_LIVE = 10;
let live = 0;

const canAnimate = () =>
  typeof HTMLElement !== "undefined" &&
  typeof HTMLElement.prototype.animate === "function";

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/* 镜像 div：复刻 textarea 的排版属性，把「字符索引」翻译成像素坐标 */
let mirror: HTMLDivElement | null = null;

const MIRROR_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderLeftWidth",
  "boxSizing",
  "tabSize",
] as const;

/** 光标在视口中的坐标（textarea 内滚动已扣除）；测量失败返回 null */
function caretViewportPos(
  ta: HTMLTextAreaElement
): { x: number; y: number } | null {
  try {
    const doc = ta.ownerDocument;
    if (!mirror || mirror.ownerDocument !== doc) {
      mirror = doc.createElement("div");
      mirror.style.cssText =
        "position:fixed;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none;";
      doc.body.appendChild(mirror);
    }
    const cs = getComputedStyle(ta);
    for (const p of MIRROR_PROPS) {
      mirror.style[p as never] = cs[p as never];
    }
    // 与 textarea 相同的换行策略
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    mirror.style.width = `${ta.clientWidth}px`;

    const idx = ta.selectionEnd ?? ta.value.length;
    mirror.textContent = ta.value.slice(0, idx);
    const marker = doc.createElement("span");
    marker.textContent = "​";
    mirror.appendChild(marker);

    const rect = ta.getBoundingClientRect();
    const lineH = parseFloat(cs.lineHeight) || 20;
    return {
      x: rect.left + marker.offsetLeft - ta.scrollLeft,
      y: rect.top + marker.offsetTop - ta.scrollTop + lineH * 0.55,
    };
  } catch {
    return null;
  }
}

interface SparkSpec {
  color: string;
  glow: string;
  /** 位移范围：录入向上弹，删除向下坠 */
  dx: () => number;
  dy: () => number;
  duration: () => number;
}

const INPUT_COLORS: Array<[string, string]> = [
  ["var(--energy-volt)", "var(--glow-volt)"],
  ["var(--energy-circuit)", "var(--glow-circuit)"],
];

function specFor(kind: "input" | "delete"): SparkSpec {
  if (kind === "delete") {
    return {
      color: "var(--vsc-fg-faint)",
      glow: "transparent",
      dx: () => (Math.random() - 0.5) * 12,
      dy: () => 8 + Math.random() * 8,
      duration: () => 240 + Math.random() * 80,
    };
  }
  const [color, glow] =
    INPUT_COLORS[Math.random() < 0.75 ? 0 : 1];
  return {
    color,
    glow,
    dx: () => (Math.random() - 0.5) * 26,
    dy: () => -(8 + Math.random() * 14),
    duration: () => 260 + Math.random() * 90,
  };
}

/** 在 textarea 光标处溅出 count 颗火花；一切能力缺失场景静默降级 */
export function spawnTypeSparks(
  ta: HTMLTextAreaElement,
  kind: "input" | "delete",
  count = 2
): void {
  if (!canAnimate() || prefersReducedMotion()) return;
  if (live >= MAX_LIVE) return;
  const pos = caretViewportPos(ta);
  if (!pos) return;
  // 光标滚出可视区（长文本上翻）时不放：火花不该出现在框外
  const rect = ta.getBoundingClientRect();
  if (pos.y < rect.top || pos.y > rect.bottom) return;

  const n = Math.min(count, MAX_LIVE - live);
  for (let i = 0; i < n; i++) {
    const spec = specFor(kind);
    const dot = document.createElement("span");
    const size = kind === "delete" ? 3 : 2 + Math.round(Math.random());
    dot.style.cssText = `position:fixed;z-index:9999;pointer-events:none;left:${pos.x}px;top:${pos.y}px;width:${size}px;height:${size}px;border-radius:50%;background:${spec.color};box-shadow:0 0 6px ${spec.glow}`;
    document.body.appendChild(dot);
    live++;
    const anim = dot.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 0.95 },
        {
          transform: `translate(${spec.dx()}px, ${spec.dy()}px) scale(0.4)`,
          opacity: 0,
        },
      ],
      { duration: spec.duration(), easing: "cubic-bezier(0.25, 1, 0.5, 1)", fill: "forwards" }
    );
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      dot.remove();
      live--;
    };
    anim.onfinish = settle;
    anim.oncancel = settle;
  }
}
