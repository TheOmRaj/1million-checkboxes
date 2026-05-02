const API_URL = window.ENV_API_URL || "http://localhost:3001";
const TOTAL = 500;

let token = null;
let user = null;
let socket = null;
let isAnonymous = false;

let bitState = new Uint8Array(Math.ceil(TOTAL / 8));

const CHECKBOX_SIZE = 14;
const CHECKBOX_GAP = 2;
const CELL = CHECKBOX_SIZE + CHECKBOX_GAP;

let canvas, ctx;
let canvasWidth = 0, canvasHeight = 0;
let cols = 0;
let viewStart = 0;
let totalVisible = 0;

let checkedCount = 0;
let onlineUsers = 0;

let dirtySet = new Set();
let animationFrame = null;

function getBit(index) {
  return (bitState[index >> 3] >> (7 - (index & 7))) & 1;
}

function setBit(index, val) {
  const byte = index >> 3;
  const bit = 7 - (index & 7);
  if (val) {
    bitState[byte] |= (1 << bit);
  } else {
    bitState[byte] &= ~(1 << bit);
  }
}

function toggleBit(index) {
  const newVal = getBit(index) ? 0 : 1;
  setBit(index, newVal);
  return newVal;
}

function getToken() {
  return localStorage.getItem("cb_token");
}

function saveToken(t) {
  localStorage.setItem("cb_token", t);
  token = t;
}

function clearToken() {
  localStorage.removeItem("cb_token");
  token = null;
  user = null;
}

async function fetchUser(t) {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    const data = await res.json();
    return data.user;
  } catch {
    return null;
  }
}

async function init() {

  const params = new URLSearchParams(location.search);
  if (params.has("token")) {
    saveToken(params.get("token"));
    history.replaceState({}, "", "/");
  }
  if (params.has("auth_error")) {
    showToast("Login failed: " + params.get("auth_error"), "error");
    history.replaceState({}, "", "/");
  }

  token = getToken();

  if (token) {
    user = await fetchUser(token);
    if (!user) {
      clearToken();
    }
  }

  const wantsAnon = sessionStorage.getItem("cb_anon") === "1";

  if (user || wantsAnon) {
    isAnonymous = !user;
    showApp();
  } else {
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
}

function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");

  if (user) {
    document.getElementById("user-info").classList.remove("hidden");
    document.getElementById("user-name").textContent = user.name || user.email;
    if (user.picture) document.getElementById("user-avatar").src = user.picture;
    document.getElementById("logout-btn").classList.remove("hidden");
    document.getElementById("toggle-hint").textContent = "Click to toggle · Scroll to navigate";
  } else {
    document.getElementById("anon-badge").classList.remove("hidden");
    document.getElementById("toggle-hint").textContent = "Read-only · Sign in to toggle";
  }

  setupCanvas();
  loadState();
  connectSocket();
}

function setupCanvas() {
  canvas = document.getElementById("checkbox-canvas");
  ctx = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", () => { resize(); scheduleRedraw(); });
  canvas.addEventListener("click", onCanvasClick);
  canvas.addEventListener("mousemove", onCanvasHover);
  canvas.addEventListener("mouseleave", () => {
    document.getElementById("hover-tooltip").classList.add("hidden");
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });
}

function resize() {
  const main = document.querySelector("main");
  canvasWidth = main.clientWidth;
  canvasHeight = main.clientHeight;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  cols = Math.floor(canvasWidth / CELL);
  const rows = Math.floor(canvasHeight / CELL);
  totalVisible = cols * rows;

  viewStart = Math.floor(viewStart / cols) * cols;
  clampView();
  updateLabels();
  drawAll();
}

function clampView() {
  const maxStart = Math.max(0, TOTAL - totalVisible);
  viewStart = Math.max(0, Math.min(viewStart, Math.floor(maxStart / cols) * cols));
}

function scheduleRedraw(indices) {
  if (indices) indices.forEach(i => dirtySet.add(i));
  if (!animationFrame) {
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      if (dirtySet.size > 0 && dirtySet.size < 2000) {
        drawDirty();
      } else {
        drawAll();
        dirtySet.clear();
      }
    });
  }
}

function indexToXY(globalIndex) {
  const local = globalIndex - viewStart;
  if (local < 0 || local >= totalVisible) return null;
  const row = Math.floor(local / cols);
  const col = local % cols;
  return { x: col * CELL, y: row * CELL };
}

function drawCheckbox(x, y, checked, highlight) {
  const s = CHECKBOX_SIZE;
  if (checked) {
    ctx.fillStyle = highlight ? "#00ffaa" : "#00ff88";
    ctx.fillRect(x, y, s, s);

    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + s / 2);
    ctx.lineTo(x + s / 2 - 1, y + s - 4);
    ctx.lineTo(x + s - 3, y + 3);
    ctx.stroke();
  } else {
    ctx.fillStyle = highlight ? "#1c1c26" : "#13131a";
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = highlight ? "#444458" : "#2a2a3a";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }
}

function drawAll() {
  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const end = Math.min(viewStart + totalVisible, TOTAL);
  for (let i = viewStart; i < end; i++) {
    const local = i - viewStart;
    const col = local % cols;
    const row = Math.floor(local / cols);
    drawCheckbox(col * CELL, row * CELL, getBit(i) === 1, false);
  }
}

function drawDirty() {
  for (const i of dirtySet) {
    const pos = indexToXY(i);
    if (pos) drawCheckbox(pos.x, pos.y, getBit(i) === 1, false);
  }
  dirtySet.clear();
}

function xyToIndex(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const col = Math.floor(x / CELL);
  const row = Math.floor(y / CELL);
  if (col < 0 || col >= cols) return -1;
  const local = row * cols + col;
  const global = viewStart + local;
  if (global >= TOTAL) return -1;
  return global;
}

let toggleTimes = [];
function isRateLimited() {
  const now = Date.now();
  toggleTimes = toggleTimes.filter(t => now - t < 1000);
  if (toggleTimes.length >= 15) return true;
  toggleTimes.push(now);
  return false;
}

function onCanvasClick(e) {
  if (isAnonymous) {
    showToast("Sign in to toggle checkboxes", "info");
    return;
  }
  const index = xyToIndex(e.clientX, e.clientY);
  if (index < 0) return;

  if (isRateLimited()) {
    document.getElementById("rate-warn").classList.remove("hidden");
    setTimeout(() => document.getElementById("rate-warn").classList.add("hidden"), 1500);
    return;
  }

  const newVal = toggleBit(index);
  checkedCount += newVal ? 1 : -1;
  updateCheckedCount();
  scheduleRedraw([index]);

  socket.emit("checkbox:toggle", { index }, (ack) => {
    if (ack?.error) {

      toggleBit(index);
      checkedCount += newVal ? -1 : 1;
      updateCheckedCount();
      scheduleRedraw([index]);
      showToast(ack.error, "error");
    }
  });
}

let hoverIndex = -1;
function onCanvasHover(e) {
  const index = xyToIndex(e.clientX, e.clientY);
  if (index === hoverIndex) return;

  const prev = hoverIndex;
  hoverIndex = index;

  const tooltip = document.getElementById("hover-tooltip");
  if (index < 0) {
    tooltip.classList.add("hidden");
    if (prev >= 0) scheduleRedraw([prev]);
    return;
  }

  tooltip.textContent = `#${(index + 1).toLocaleString()} — ${getBit(index) ? "✓ checked" : "unchecked"}`;
  tooltip.style.left = (e.clientX + 14) + "px";
  tooltip.style.top = (e.clientY - 24) + "px";
  tooltip.classList.remove("hidden");

  if (prev >= 0) scheduleRedraw([prev]);
  scheduleRedraw([index]);
}

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? cols * 5 : -cols * 5;
  viewStart = Math.max(0, Math.min(viewStart + delta, Math.floor((TOTAL - totalVisible) / cols) * cols));
  clampView();
  updateLabels();
  scheduleRedraw();
}

async function loadState() {
  try {
    const res = await fetch(`${API_URL}/api/checkboxes/state`);
    const data = await res.json();

    if (data.state) {

      const binary = atob(data.state);
      for (let i = 0; i < binary.length && i < bitState.length; i++) {
        bitState[i] = binary.charCodeAt(i);
      }
    }
    checkedCount = data.checkedCount || 0;
    updateCheckedCount();
    drawAll();
  } catch (err) {
    showToast("Failed to load checkbox state", "error");
    console.error(err);
  }
}

function connectSocket() {
  const connDot = document.getElementById("conn-status");
  connDot.className = "conn-dot connecting";

  socket = io(API_URL, {
    auth: { token: token || "" },
    transports: ["websocket"],
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on("connect", () => {
    connDot.className = "conn-dot connected";
  });

  socket.on("disconnect", () => {
    connDot.className = "conn-dot disconnected";
  });

  socket.on("connect_error", (err) => {
    connDot.className = "conn-dot disconnected";
    console.error("Socket error:", err.message);
  });

  socket.on("checkbox:updated", ({ index, value, userId }) => {
    const oldVal = getBit(index);
    const newVal = value ? 1 : 0;
    if (oldVal !== newVal) {
      setBit(index, newVal);
      checkedCount += newVal ? 1 : -1;
      updateCheckedCount();
      scheduleRedraw([index]);

      flashCell(index);
    }
  });

  socket.on("users:count", ({ count }) => {
    onlineUsers = count;
    document.getElementById("users-count").textContent = count.toLocaleString();
  });
}

function flashCell(index) {
  const pos = indexToXY(index);
  if (!pos) return;
  const { x, y } = pos;
  const val = getBit(index);

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = val ? "#00ffcc" : "#ff4455";
  ctx.fillRect(x, y, CHECKBOX_SIZE, CHECKBOX_SIZE);
  ctx.restore();
  setTimeout(() => {
    if (animationFrame === null) drawCheckbox(x, y, val === 1, false);
  }, 150);
}

function goToCheckbox(index) {
  if (index < 0 || index >= TOTAL) return;
  viewStart = Math.floor(index / cols) * cols;
  clampView();
  updateLabels();
  scheduleRedraw();
}

function updateLabels() {
  const end = Math.min(viewStart + totalVisible, TOTAL);
  document.getElementById("range-label").textContent =
    `${(viewStart + 1).toLocaleString()} – ${end.toLocaleString()}`;
  const page = Math.floor(viewStart / totalVisible) + 1;
  const totalPages = Math.ceil(TOTAL / totalVisible);
  document.getElementById("page-label").textContent = `Page ${page} / ${totalPages}`;
}

function updateCheckedCount() {
  document.getElementById("checked-count").textContent = checkedCount.toLocaleString();
}

function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

document.getElementById("login-btn").addEventListener("click", () => {
  window.location.href = `${API_URL}/auth/login`;
});

document.getElementById("anon-btn").addEventListener("click", () => {
  sessionStorage.setItem("cb_anon", "1");
  isAnonymous = true;
  showApp();
});

document.getElementById("logout-btn").addEventListener("click", () => {
  clearToken();
  sessionStorage.removeItem("cb_anon");
  if (socket) socket.disconnect();
  showAuthScreen();
});

document.getElementById("goto-btn").addEventListener("click", () => {
  const val = parseInt(document.getElementById("goto-input").value);
  if (!isNaN(val) && val >= 1 && val <= TOTAL) {
    goToCheckbox(val - 1);
  }
});

document.getElementById("goto-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("goto-btn").click();
});

document.getElementById("prev-page").addEventListener("click", () => {
  viewStart = Math.max(0, viewStart - totalVisible);
  clampView();
  updateLabels();
  scheduleRedraw();
});

document.getElementById("next-page").addEventListener("click", () => {
  viewStart = Math.min(
    Math.floor((TOTAL - totalVisible) / cols) * cols,
    viewStart + totalVisible
  );
  clampView();
  updateLabels();
  scheduleRedraw();
});

init();
