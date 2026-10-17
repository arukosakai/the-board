import { connect, createRenderer, newId, styleText } from "/static/board.js";
import { download, exportBoardFile, importBoardFile, isBoardFile, renderPng } from "/static/export.js";

const CLIPBOARD_MARK = "the-board/object:";
const MIN_SIZE = 12;
const HISTORY_LIMIT = 200;

const clientId = newId();
const board = document.getElementById("board");
const overlay = document.getElementById("overlay");
const viewportsLayer = document.getElementById("viewports");
const renderer = createRenderer(document.getElementById("objects"));
const $ = (id) => document.getElementById(id);

let state = { board: { bg: "#14161b" }, objects: [] };
let selectedId = null;
let viewers = [];
let gesture = null;
const undoStack = [];
const redoStack = [];

const measurer = document.createElement("div");
measurer.className = "obj-text measure";
document.body.appendChild(measurer);

// ---------- helpers ----------

const boardHeight = () => board.clientHeight;
const selected = () => state.objects.find((o) => o.id === selectedId) ?? null;
const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);

function rotate([x, y], deg) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [x * cos - y * sin, x * sin + y * cos];
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2500);
}

function snapshot() {
  return JSON.stringify({ board: state.board, objects: state.objects });
}

function checkpoint() {
  const snap = snapshot();
  if (undoStack.at(-1) === snap) return;
  undoStack.push(snap);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function restore(snap) {
  const parsed = JSON.parse(snap);
  state.board = parsed.board;
  state.objects = parsed.objects;
  if (!selected()) selectedId = null;
  commit();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

// Text boxes are sized from the rendered text, so the viewer gets exact dimensions.
function measureText(obj) {
  styleText(measurer, obj);
  const rect = measurer.getBoundingClientRect();
  return { w: Math.ceil(rect.width), h: Math.ceil(rect.height) };
}

// Re-fits a text box after its content/style changed, keeping its top-left corner put.
function refitText(obj) {
  const { w, h } = measureText(obj);
  const [tlx, tly] = rotate([-obj.w / 2, -obj.h / 2], obj.rot);
  const [ncx, ncy] = rotate([w / 2, h / 2], obj.rot);
  const screenCy = boardHeight() - obj.cy;
  obj.cx = obj.cx + tlx + ncx;
  obj.cy = boardHeight() - (screenCy + tly + ncy);
  obj.w = w;
  obj.h = h;
}

// ---------- sync ----------

let pushing = false;
let pushQueued = false;

async function push() {
  if (pushing) {
    pushQueued = true;
    return;
  }
  pushing = true;
  try {
    do {
      pushQueued = false;
      await fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, board: state.board, objects: state.objects }),
      }).catch(() => toast("sync failed — is the server running?"));
    } while (pushQueued);
  } finally {
    pushing = false;
  }
}

function commit() {
  render();
  push();
}

const source = connect("editor", clientId, {
  onOpen: () => $("conn").classList.add("online"),
  onState(remote) {
    if (remote.origin === clientId || gesture) return;
    state = { board: remote.board, objects: remote.objects };
    if (!selected()) selectedId = null;
    render();
  },
  onViewers(list) {
    viewers = list;
    renderPngTargets();
    viewportsLayer.replaceChildren(
      ...viewers.map((v, i) => {
        const el = document.createElement("div");
        el.className = "viewport-outline";
        el.style.width = `${v.w}px`;
        el.style.height = `${v.h}px`;
        el.innerHTML = `<span>viewer ${i + 1} · ${v.w}×${v.h}</span>`;
        return el;
      }),
    );
  },
});
source.addEventListener("error", () => $("conn").classList.remove("online"));

// ---------- rendering ----------

function render() {
  board.style.background = state.board.bg;
  renderer.render(state.objects);
  renderSelection();
  renderPanel();
  renderLayers();
  renderToolbar();
}

function renderToolbar() {
  const hasSelection = !!selected();
  for (const button of document.querySelectorAll("[data-needs-selection]")) button.disabled = !hasSelection;
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  $("empty-hint").hidden = state.objects.length > 0;
  $("side").hidden = state.objects.length === 0;
}

function renderPngTargets() {
  const targets = [
    { label: "editor", w: board.clientWidth, h: boardHeight() },
    ...viewers.map((v, i) => ({ label: `viewer ${i + 1}`, w: v.w, h: v.h })),
  ];
  $("png-targets").replaceChildren(
    ...targets.map((t) => {
      const button = document.createElement("button");
      button.className = "item";
      button.dataset.action = "export-png";
      button.dataset.w = t.w;
      button.dataset.h = t.h;
      button.innerHTML = `Export PNG <span class="hint">${t.label} · ${t.w}×${t.h}</span>`;
      return button;
    }),
  );
}

function renderSelection() {
  const obj = selected();
  if (!obj) {
    overlay.replaceChildren();
    return;
  }
  let box = overlay.firstElementChild;
  if (!box) {
    box = document.createElement("div");
    box.className = "selection";
    box.innerHTML = `
      <div class="rot-line"></div>
      <div class="handle" data-handle="rotate"></div>
      <div class="handle" data-handle="nw"></div>
      <div class="handle" data-handle="ne"></div>
      <div class="handle" data-handle="sw"></div>
      <div class="handle" data-handle="se"></div>`;
    overlay.appendChild(box);
  }
  box.style.left = `${obj.cx - obj.w / 2}px`;
  box.style.top = `${boardHeight() - obj.cy - obj.h / 2}px`;
  box.style.width = `${obj.w}px`;
  box.style.height = `${obj.h}px`;
  box.style.transform = `rotate(${obj.rot}deg)`;
}

function setValue(id, value, prop = "value") {
  const el = $(id);
  if (document.activeElement !== el) el[prop] = value;
}

function renderPanel() {
  setValue("board-bg", state.board.bg);
  const obj = selected();
  $("props").hidden = !obj;
  if (!obj) return;
  const isText = obj.type === "text";
  $("text-props").hidden = !isText;
  $("image-props").hidden = isText;
  if (isText) {
    setValue("p-text", obj.text);
    setValue("p-fontSize", Math.round(obj.fontSize));
    setValue("p-font", obj.font);
    setValue("p-bold", obj.bold, "checked");
    setValue("p-italic", obj.italic, "checked");
    setValue("p-align", obj.align);
    setValue("p-color", obj.color);
    setValue("p-bg", obj.bg);
    setValue("p-bgOpacity", obj.bgOpacity);
  }
  setValue("p-opacity", obj.opacity);
  setValue("p-rot", Math.round(obj.rot));
  $("geom").textContent =
    `x ${Math.round(obj.cx - obj.w / 2)} · y ${Math.round(obj.cy - obj.h / 2)} (from bottom-left) · ` +
    `${Math.round(obj.w)}×${Math.round(obj.h)}`;
}

let layersKey = "";

function renderLayers() {
  // Rebuilding on every drag frame would flicker the thumbnails and restart GIF previews.
  const key = JSON.stringify([selectedId, state.objects.map((o) => [o.id, o.src, o.text, o.color, o.name])]);
  if (key === layersKey) return;
  layersKey = key;
  const list = $("layers");
  $("layer-count").textContent = state.objects.length;
  list.replaceChildren(
    ...[...state.objects].reverse().map((obj) => {
      const li = document.createElement("li");
      li.dataset.id = obj.id;
      li.classList.toggle("selected", obj.id === selectedId);
      const thumb = document.createElement("span");
      thumb.className = "thumb";
      const name = document.createElement("span");
      name.className = "name";
      if (obj.type === "image") {
        const img = document.createElement("img");
        img.src = obj.src;
        thumb.appendChild(img);
        name.textContent = obj.name || "image";
      } else {
        thumb.textContent = "T";
        thumb.style.color = obj.color;
        name.textContent = obj.text.split("\n")[0] || "(empty text)";
      }
      li.append(thumb, name);
      return li;
    }),
  );
}

$("layers").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (li) select(li.dataset.id);
});

function select(id) {
  selectedId = id;
  render();
}

// ---------- object creation ----------

function addObject(obj) {
  checkpoint();
  state.objects.push(obj);
  selectedId = obj.id;
  commit();
}

function viewCenter() {
  return { cx: board.clientWidth / 2, cy: boardHeight() / 2 };
}

function addText(text = "Text", at = viewCenter()) {
  const obj = {
    id: newId(),
    type: "text",
    text,
    fontSize: 48,
    font: "sans",
    bold: true,
    italic: false,
    align: "left",
    color: "#ffffff",
    bg: "#000000",
    bgOpacity: 0.6,
    opacity: 1,
    rot: 0,
    ...at,
  };
  Object.assign(obj, measureText(obj));
  addObject(obj);
  $("p-text").focus();
  $("p-text").select();
}

function loadImageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

async function addImageFromUrl(src, name, at = viewCenter()) {
  const natural = await loadImageSize(src);
  const fit = Math.min(1, (board.clientWidth * 0.6) / natural.w, (boardHeight() * 0.6) / natural.h);
  addObject({
    id: newId(),
    type: "image",
    src,
    name,
    naturalW: natural.w,
    naturalH: natural.h,
    w: Math.max(MIN_SIZE, natural.w * fit),
    h: Math.max(MIN_SIZE, natural.h * fit),
    rot: 0,
    opacity: 1,
    ...at,
  });
}

async function uploadBlob(blob) {
  const res = await fetch("/api/assets", {
    method: "POST",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return (await res.json()).url;
}

async function importRemote(url) {
  const res = await fetch("/api/assets/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return (await res.json()).url;
}

async function addImageFile(file, at) {
  try {
    await addImageFromUrl(await uploadBlob(file), file.name || "pasted image", at);
  } catch (err) {
    toast(`couldn't add image: ${err.message}`);
  }
}

function nameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop()) || "image";
  } catch {
    return "image";
  }
}

// Clipboard/drop sources ranked so animated GIFs survive: a real GIF file wins,
// then the original URL from HTML (browsers' "Copy image" puts a static PNG next to it),
// then whatever raster file is there, then plain-text URLs / text.
// Everything is read up front: the DataTransfer goes empty once the event handler returns.
async function ingest(data, at) {
  const boardFile = [...(data.files || [])].find(isBoardFile);
  const files = [...(data.files || [])].filter((f) => f.type.startsWith("image/"));
  const html = data.getData("text/html");
  const text = (data.getData("text/uri-list") || data.getData("text/plain") || "").trim();

  if (boardFile) return importBoard(boardFile);

  const gif = files.find((f) => f.type === "image/gif");
  if (gif) return addImageFile(gif, at);

  const htmlSrc = html && new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src");
  if (htmlSrc?.startsWith("data:image/")) {
    return addImageFile(await (await fetch(htmlSrc)).blob(), at);
  }
  if (htmlSrc && /^https?:/.test(htmlSrc)) {
    try {
      return await addImageFromUrl(await importRemote(htmlSrc), nameFromUrl(htmlSrc), at);
    } catch {
      // fall through to the clipboard's own bitmap
    }
  }

  if (files.length) {
    for (const file of files) await addImageFile(file, at);
    return;
  }

  if (!text) return;
  if (/^https?:\/\/\S+$/.test(text)) {
    try {
      return await addImageFromUrl(await importRemote(text), nameFromUrl(text), at);
    } catch {
      // not an image URL, treat it as text
    }
  }
  addText(text, at);
}

document.addEventListener("paste", (e) => {
  if (isTyping()) return;
  e.preventDefault();
  const plain = e.clipboardData.getData("text/plain");
  if (plain.startsWith(CLIPBOARD_MARK)) {
    try {
      const obj = JSON.parse(plain.slice(CLIPBOARD_MARK.length));
      addObject({ ...obj, id: newId(), cx: obj.cx + 20, cy: obj.cy - 20 });
    } catch {
      toast("couldn't paste that object");
    }
    return;
  }
  ingest(e.clipboardData);
});

function copySelection(e) {
  const obj = selected();
  if (isTyping() || !obj) return false;
  e.preventDefault();
  e.clipboardData.setData("text/plain", CLIPBOARD_MARK + JSON.stringify(obj));
  return true;
}

document.addEventListener("copy", copySelection);
document.addEventListener("cut", (e) => {
  if (copySelection(e)) removeSelected();
});

board.addEventListener("dragover", (e) => {
  e.preventDefault();
  board.classList.add("dragover");
});
board.addEventListener("dragleave", () => board.classList.remove("dragover"));
board.addEventListener("drop", (e) => {
  e.preventDefault();
  board.classList.remove("dragover");
  ingest(e.dataTransfer, { cx: e.clientX, cy: boardHeight() - e.clientY });
});

$("file-input").addEventListener("change", async (e) => {
  for (const file of e.target.files) await addImageFile(file);
  e.target.value = "";
});

$("import-input").addEventListener("change", async (e) => {
  const [file] = e.target.files;
  e.target.value = "";
  closeMenu();
  if (file) await importBoard(file);
});

// ---------- export / import ----------

const timestamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");

async function exportPng(width, height) {
  closeMenu();
  try {
    download(await renderPng(state, width, height), `the-board-${timestamp()}.png`);
  } catch (err) {
    toast(`export failed: ${err.message}`);
  }
}

async function exportBoard() {
  closeMenu();
  try {
    download(await exportBoardFile(state), `the-board-${timestamp()}.json`);
  } catch (err) {
    toast(`export failed: ${err.message}`);
  }
}

async function importBoard(file) {
  try {
    const imported = await importBoardFile(file, uploadBlob);
    checkpoint();
    state.board = imported.board;
    state.objects = imported.objects;
    selectedId = null;
    commit();
    toast(`imported ${imported.objects.length} objects`);
  } catch (err) {
    toast(`import failed: ${err.message}`);
  }
}

function closeMenu() {
  $("menu").hidden = true;
}

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#menu, [data-action='toggle-menu']")) closeMenu();
});

// ---------- editing actions ----------

function removeSelected() {
  if (!selected()) return;
  checkpoint();
  state.objects = state.objects.filter((o) => o.id !== selectedId);
  selectedId = null;
  commit();
}

function duplicateSelected() {
  const obj = selected();
  if (obj) addObject({ ...structuredClone(obj), id: newId(), cx: obj.cx + 20, cy: obj.cy - 20 });
}

function moveLayer(to) {
  const index = state.objects.findIndex((o) => o.id === selectedId);
  if (index < 0) return;
  const last = state.objects.length - 1;
  const target = { front: last, back: 0, forward: Math.min(last, index + 1), backward: Math.max(0, index - 1) }[to];
  if (target === index) return;
  checkpoint();
  const [obj] = state.objects.splice(index, 1);
  state.objects.splice(target, 0, obj);
  commit();
}

function updateSelected(mutate) {
  const obj = selected();
  if (!obj) return;
  checkpoint();
  mutate(obj);
  if (obj.type === "text") refitText(obj);
  commit();
}

const actions = {
  "add-text": () => addText(),
  "to-front": () => moveLayer("front"),
  forward: () => moveLayer("forward"),
  backward: () => moveLayer("backward"),
  "to-back": () => moveLayer("back"),
  duplicate: duplicateSelected,
  delete: removeSelected,
  undo,
  redo,
  "toggle-ui": () => {
    closeMenu();
    document.body.classList.toggle("ui-hidden");
  },
  "toggle-menu": () => {
    renderPngTargets();
    $("menu").hidden = !$("menu").hidden;
  },
  "toggle-layers": () => $("layers-section").classList.toggle("collapsed"),
  "export-png": (button) => exportPng(Number(button.dataset.w), Number(button.dataset.h)),
  "export-board": exportBoard,
  "reset-rotation": () => updateSelected((o) => (o.rot = 0)),
  "natural-size": () =>
    updateSelected((o) => {
      o.w = o.naturalW;
      o.h = o.naturalH;
    }),
};

document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (button && !button.disabled) actions[button.dataset.action](button);
});

// Property inputs: one undo checkpoint per focus, live updates while typing/dragging sliders.
const props = {
  "p-text": ["text", (el) => el.value],
  "p-fontSize": ["fontSize", (el) => Math.max(4, Number(el.value) || 4)],
  "p-font": ["font", (el) => el.value],
  "p-bold": ["bold", (el) => el.checked],
  "p-italic": ["italic", (el) => el.checked],
  "p-align": ["align", (el) => el.value],
  "p-color": ["color", (el) => el.value],
  "p-bg": ["bg", (el) => el.value],
  "p-bgOpacity": ["bgOpacity", (el) => Number(el.value)],
  "p-opacity": ["opacity", (el) => Number(el.value)],
  "p-rot": ["rot", (el) => Number(el.value) || 0],
};

for (const [id, [key, read]] of Object.entries(props)) {
  const el = $(id);
  el.addEventListener("focus", checkpoint);
  el.addEventListener("input", () => {
    const obj = selected();
    if (!obj) return;
    if (document.activeElement !== el) checkpoint();
    obj[key] = read(el);
    if (obj.type === "text") refitText(obj);
    commit();
  });
}

$("board-bg").addEventListener("focus", checkpoint);
$("board-bg").addEventListener("input", (e) => {
  state.board.bg = e.target.value;
  commit();
});

// ---------- pointer gestures: move / resize / rotate ----------

const CORNER_SIGNS = { nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] };

board.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  document.activeElement?.blur();
  const handle = e.target.closest("[data-handle]")?.dataset.handle;
  const objEl = e.target.closest(".obj");

  if (!handle) {
    if (!objEl) return select(null);
    select(objEl.dataset.id);
  }

  const obj = selected();
  checkpoint();
  gesture = {
    kind: handle ?? "move",
    start: structuredClone(obj),
    x: e.clientX,
    y: e.clientY,
  };
  board.setPointerCapture(e.pointerId);
  e.preventDefault();
});

board.addEventListener("pointermove", (e) => {
  if (!gesture) return;
  const obj = selected();
  if (!obj) return;
  const s = gesture.start;
  const H = boardHeight();

  if (gesture.kind === "move") {
    obj.cx = s.cx + (e.clientX - gesture.x);
    obj.cy = s.cy - (e.clientY - gesture.y);
  } else if (gesture.kind === "rotate") {
    let angle = (Math.atan2(e.clientY - (H - s.cy), e.clientX - s.cx) * 180) / Math.PI + 90;
    if (e.shiftKey) angle = Math.round(angle / 15) * 15;
    obj.rot = ((angle + 540) % 360) - 180;
  } else {
    resize(obj, s, CORNER_SIGNS[gesture.kind], e);
  }
  commit();
});

// Resizes around the opposite corner, which stays pinned. Works in the object's own
// rotated frame (screen coords, y down). Images and text keep aspect unless Shift is held
// (text always does, since its size comes from the font size).
function resize(obj, s, [sx, sy], e) {
  const H = boardHeight();
  const center = [s.cx, H - s.cy];
  const [ox, oy] = rotate([(-sx * s.w) / 2, (-sy * s.h) / 2], s.rot);
  const anchor = [center[0] + ox, center[1] + oy];
  const [lx, ly] = rotate([e.clientX - anchor[0], e.clientY - anchor[1]], -s.rot);

  let w = Math.max(MIN_SIZE, sx * lx);
  let h = Math.max(MIN_SIZE, sy * ly);
  const keepAspect = s.type === "text" || !e.shiftKey;
  if (keepAspect) {
    const scale = Math.max(w / s.w, h / s.h, MIN_SIZE / Math.min(s.w, s.h));
    w = s.w * scale;
    h = s.h * scale;
    if (s.type === "text") obj.fontSize = s.fontSize * scale;
  }

  const [hx, hy] = rotate([(sx * w) / 2, (sy * h) / 2], s.rot);
  obj.w = w;
  obj.h = h;
  obj.cx = anchor[0] + hx;
  obj.cy = H - (anchor[1] + hy);
}

function endGesture() {
  if (!gesture) return;
  gesture = null;
  if (undoStack.at(-1) === snapshot()) undoStack.pop();
  const obj = selected();
  if (obj?.type === "text") {
    refitText(obj);
    commit();
  }
}

board.addEventListener("pointerup", endGesture);
board.addEventListener("pointercancel", endGesture);

board.addEventListener("dblclick", (e) => {
  if (e.target.closest(".obj")?.dataset.type === "text") {
    $("p-text").focus();
    $("p-text").select();
  }
});

// ---------- keyboard ----------

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === "z" && !isTyping()) {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && key === "y" && !isTyping()) {
    e.preventDefault();
    return redo();
  }
  if (e.key === "Escape") {
    closeMenu();
    document.activeElement?.blur();
    return select(null);
  }
  if (isTyping()) return;

  if (mod && key === "d") {
    e.preventDefault();
    return duplicateSelected();
  }
  // e.code, not e.key: Shift and non-US layouts change the character the bracket keys produce.
  const layerMove = {
    BracketRight: mod || e.shiftKey ? "front" : "forward",
    BracketLeft: mod || e.shiftKey ? "back" : "backward",
    PageUp: "forward",
    PageDown: "backward",
    Home: "front",
    End: "back",
  }[e.code];
  if (layerMove && selected()) {
    e.preventDefault();
    return moveLayer(layerMove);
  }
  if (e.key === "Delete" || e.key === "Backspace") return removeSelected();
  if (key === "h" && !mod) return actions["toggle-ui"]();
  if (key === "t" && !mod) return addText();

  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (nudge && selected()) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    updateSelected((o) => {
      o.cx += nudge[0] * step;
      o.cy += nudge[1] * step;
    });
  }
});

window.addEventListener("resize", renderSelection);
