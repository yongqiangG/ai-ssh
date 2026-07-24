/**
 * 命令「飞向终端」动效（三幕：蓄力弹射 → 弧线拖尾 → 着陆冲击）。
 *
 * 手动执行按钮与写命令确认门共用（决议见 docs/situations/260724-confirm-fly-animation.md）。
 * 全程 Web Animations API + transform/opacity（合成器友好，零布局抖动）；
 * 弧线由「外层 X 加速 + 内层 Y 先抛后落」两层位移合成；速度感来自 2 个延迟残影。
 * prefers-reduced-motion 或无 WAAPI（jsdom）时降级为落点单次发光，注意力指向不丢。
 */

const FLIGHT_MS = 560;
const TRAIL_DELAYS = [45, 90];
const TRAIL_OPACITY = [0.35, 0.15];

const canAnimate = () =>
  typeof HTMLElement !== "undefined" &&
  typeof HTMLElement.prototype.animate === "function";

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** 落点发光（降级路径也保留：告诉用户「命令去终端了」） */
function glowTarget(target: HTMLElement) {
  const prevShadow = target.style.boxShadow;
  const prevTransition = target.style.transition;
  target.style.transition = "box-shadow .25s ease-out";
  target.style.boxShadow =
    "inset 0 0 0 2px var(--vsc-accent), inset 0 0 40px var(--accent-glow)";
  window.setTimeout(() => {
    target.style.boxShadow = prevShadow;
    target.style.transition = prevTransition;
  }, 550);
}

/** 单个飞行 chip（主体或残影）：三层嵌套合成弧线 + 姿态 */
function spawnChip(
  command: string,
  from: DOMRect,
  dx: number,
  dy: number,
  opacity: number,
  delay: number
): HTMLElement {
  const outer = document.createElement("div");
  outer.style.cssText = `position:fixed;z-index:9999;pointer-events:none;left:${from.left}px;top:${from.top}px;opacity:${opacity}`;
  const mid = document.createElement("div");
  const chip = document.createElement("div");
  chip.textContent = "▶ " + command;
  chip.style.cssText =
    "max-width:300px;padding:5px 11px;border-radius:6px;background:var(--vsc-accent);color:var(--vsc-accent-fg);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 20px rgba(0,0,0,0.6),0 0 18px var(--accent-glow)";
  mid.appendChild(chip);
  outer.appendChild(mid);
  document.body.appendChild(outer);

  const timing: KeyframeAnimationOptions = {
    duration: FLIGHT_MS,
    delay,
    fill: "forwards",
    easing: "linear",
  };
  // 第一幕（offset 0~0.16）：向后微退蓄力；随后 X 全程加速冲向终端
  outer.animate(
    [
      { transform: "translateX(0)", offset: 0 },
      { transform: "translateX(-4px)", offset: 0.16 },
      { transform: `translateX(${dx * 0.28}px)`, offset: 0.55 },
      { transform: `translateX(${dx}px)`, offset: 1 },
    ],
    timing
  );
  // 第二幕：Y 先上抛后落下，与 X 合成抛物线
  mid.animate(
    [
      { transform: "translateY(0)", offset: 0 },
      { transform: "translateY(2px)", offset: 0.16 },
      { transform: `translateY(${dy * 0.35 - 40}px)`, offset: 0.55 },
      { transform: `translateY(${dy}px)`, offset: 1 },
    ],
    timing
  );
  // 姿态跟随速度：蓄力微缩 → 起飞仰角 → 回正 → 俯冲 → 着陆 squash 湮灭
  chip.animate(
    [
      { transform: "scale(1)", opacity: 1, offset: 0 },
      { transform: "scale(0.92) rotate(0deg)", offset: 0.16 },
      { transform: "scale(1.06) rotate(-6deg)", offset: 0.34 },
      { transform: "scale(1) rotate(0deg)", offset: 0.62 },
      { transform: "scale(0.9) rotate(10deg)", opacity: 1, offset: 0.9 },
      { transform: "scale(1.15, 0.7) rotate(0deg)", opacity: 0, offset: 1 },
    ],
    timing
  );
  return outer;
}

/** 第三幕：落点冲击波 ripple + 面板震动 + 内发光 */
function impact(target: HTMLElement, to: DOMRect) {
  const cx = to.left + to.width / 2;
  const cy = to.top + to.height / 2;
  const ripple = document.createElement("div");
  ripple.style.cssText = `position:fixed;z-index:9998;pointer-events:none;left:${cx - 30}px;top:${cy - 30}px;width:60px;height:60px;border-radius:50%;border:2px solid var(--vsc-accent);box-shadow:0 0 24px var(--accent-glow)`;
  document.body.appendChild(ripple);
  ripple.animate(
    [
      { transform: "scale(0.2)", opacity: 0.85 },
      { transform: "scale(2.5)", opacity: 0 },
    ],
    { duration: 350, easing: "ease-out", fill: "forwards" }
  );
  window.setTimeout(() => ripple.remove(), 420);

  // 面板震动两下：接住了这条命令
  target.animate(
    [
      { transform: "translate(0,0)" },
      { transform: "translate(2px,1px)" },
      { transform: "translate(-2px,-1px)" },
      { transform: "translate(1px,0)" },
      { transform: "translate(0,0)" },
    ],
    { duration: 140, easing: "linear" }
  );
  glowTarget(target);
}

/**
 * 克隆命令文本从 fromEl 飞向中间工作区（#work-center）。
 * 动效纯装饰：任何环境缺失能力都静默降级，绝不影响业务动作。
 */
export function flyCommandToTerminal(fromEl: HTMLElement, command: string): void {
  const target = document.getElementById("work-center");
  if (!canAnimate() || prefersReducedMotion()) {
    if (target) glowTarget(target);
    return;
  }
  const from = fromEl.getBoundingClientRect();
  const to = target?.getBoundingClientRect() ?? {
    left: window.innerWidth / 2,
    top: window.innerHeight / 2,
    width: 0,
    height: 0,
  };
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);

  const chips: HTMLElement[] = [
    spawnChip(command, from, dx, dy, 1, 0),
    ...TRAIL_DELAYS.map((delay, i) =>
      spawnChip(command, from, dx, dy, TRAIL_OPACITY[i], delay)
    ),
  ];
  // 主 chip 着陆瞬间触发冲击；残影随后自行湮灭
  window.setTimeout(() => {
    if (target) impact(target, target.getBoundingClientRect());
  }, FLIGHT_MS - 30);
  window.setTimeout(() => chips.forEach((c) => c.remove()), FLIGHT_MS + TRAIL_DELAYS[1] + 100);
}
