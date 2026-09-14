"use strict";

const element = (id) => document.getElementById(id);
let current = null;
let finished = false;
let busy = false;
let deadline = 0;
let poll;
let revision = 0;

async function api(path, body) {
  const options =
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  const response = await fetch(`api/${path}`, {
    ...options,
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || "验证请求失败，请重试。");
  return value;
}

function focusAnswer() {
  if (current && !finished) {
    element(current.kind === "text" ? "answer" : "slider").focus();
  }
}

function setBusy(value, pendingText = "正在验证…") {
  busy = value;
  element("submit").disabled = value;
  element("refresh").disabled = value;
  element("answer").disabled = value;
  element("slider").disabled = value;
  element("submit").textContent = value ? pendingText : "验证并继续";
  if (!value) focusAnswer();
}

function finish(status, message) {
  if (finished) return;
  finished = true;
  clearTimeout(poll);
  element("form").hidden = true;
  element("loading").hidden = true;
  element("countdown").hidden = true;
  element("footer").hidden = true;
  element("title").textContent =
    status === "completed" ? "登录验证已完成" : "本次统计已结束";
  element("description").textContent =
    status === "completed"
      ? "工时统计正在继续，请返回查看结果。"
      : "返回工时工具后，可重新发起统计。";
  element("result").textContent = message;
  element("result").hidden = false;
}

function positionPiece() {
  if (!current || current.kind !== "slider") return;
  element("piece").style.left =
    `${(Number(element("slider").value) / current.width) * 100}%`;
  element("slider").setAttribute(
    "aria-valuetext",
    `向右移动 ${element("slider").value} 像素`,
  );
}

function render(state) {
  if (finished) return;
  if (state.status !== "waiting") {
    finish(state.status, state.message);
    return;
  }
  const changed = !current || current.generation !== state.generation;
  current = state;
  deadline = Date.now() + state.remaining_seconds * 1000;
  updateCountdown();
  if (finished) return;
  element("system").textContent = state.system;
  element("loading").hidden = true;
  element("form").hidden = false;
  element("message").textContent = state.message || "";
  if (!changed) return;
  element("text-challenge").hidden = state.kind !== "text";
  element("slider-challenge").hidden = state.kind !== "slider";
  if (state.kind === "text") {
    element("text-image").src = state.image;
    element("answer").value = "";
    element("answer").required = true;
    element("answer").focus();
  } else {
    element("answer").required = false;
    element("background").src = state.background;
    element("piece").src = state.piece;
    element("slider").max = state.width - state.piece_width;
    element("slider").value = 0;
    positionPiece();
    element("slider").focus();
  }
}

async function checkState() {
  if (finished) return;
  const requestedRevision = revision;
  try {
    if (!busy) {
      const state = await api("state");
      if (!busy && requestedRevision === revision) render(state);
    }
  } catch (error) {
    if (!busy && requestedRevision === revision) {
      finish(
        "failed",
        "验证连接已结束，请返回工时工具查看状态或重新发起统计。",
      );
    }
  }
  if (!finished) poll = setTimeout(checkState, 2000);
}

element("slider").addEventListener("input", positionPiece);
element("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || finished || !current) return;
  const answer =
    current.kind === "text"
      ? element("answer").value.trim()
      : Number(element("slider").value);
  if (current.kind === "text" && !/^[a-z0-9]{4}$/i.test(answer)) {
    element("message").textContent = "请输入图片中的 4 位字母或数字。";
    element("answer").focus();
    return;
  }
  revision += 1;
  setBusy(true);
  try {
    render(await api("submit", { generation: current.generation, answer }));
  } catch (error) {
    element("message").textContent = error.message;
  } finally {
    setBusy(false);
  }
});

element("refresh").addEventListener("click", async () => {
  if (busy || finished) return;
  revision += 1;
  setBusy(true, "正在换图…");
  try {
    render(await api("refresh", {}));
  } catch (error) {
    element("message").textContent = error.message;
  } finally {
    setBusy(false);
  }
});

element("cancel").addEventListener("click", async () => {
  if (finished) return;
  revision += 1;
  element("cancel").disabled = true;
  try {
    const state = await api("cancel", {});
    finish(state.status, state.message);
  } catch (error) {
    finish("cancelled", "验证连接已结束，请返回工时工具查看状态。");
  }
});

function updateCountdown() {
  if (!deadline || finished) return;
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  element("remaining").textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (seconds === 0) finish("failed", "已超过验证等待时间，请重新发起统计。");
}
setInterval(updateCountdown, 500);
checkState();
