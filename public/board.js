// Shared between editor and viewer. Objects are stored by their center (cx, cy)
// in pixels measured from the board's bottom-left corner, so both screens agree on
// where things sit no matter how big each window is.

export const FONTS = {
  sans: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Mono", Consolas, "Courier New", monospace',
  impact: 'Impact, "Arial Black", sans-serif',
};

export function newId() {
  return crypto.randomUUID();
}

export function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function styleText(el, obj) {
  const text = obj.text || " ";
  if (el.textContent !== text) el.textContent = text;
  el.style.fontSize = `${obj.fontSize}px`;
  el.style.color = obj.color;
  el.style.background = hexToRgba(obj.bg, obj.bgOpacity);
  el.style.fontWeight = obj.bold ? "700" : "400";
  el.style.fontStyle = obj.italic ? "italic" : "normal";
  el.style.fontFamily = FONTS[obj.font] || FONTS.sans;
  el.style.textAlign = obj.align || "left";
}

function createElement(obj) {
  const el = document.createElement("div");
  el.className = "obj";
  el.dataset.id = obj.id;
  el.dataset.type = obj.type;
  if (obj.type === "image") {
    const img = document.createElement("img");
    img.draggable = false;
    img.alt = "";
    el.appendChild(img);
  } else {
    const text = document.createElement("div");
    text.className = "obj-text";
    el.appendChild(text);
  }
  return el;
}

function applyObject(el, obj, index) {
  el.style.left = `${obj.cx - obj.w / 2}px`;
  el.style.bottom = `${obj.cy - obj.h / 2}px`;
  el.style.width = `${obj.w}px`;
  el.style.height = `${obj.h}px`;
  el.style.transform = `rotate(${obj.rot}deg)`;
  el.style.zIndex = String(index + 1);
  el.style.opacity = String(obj.opacity ?? 1);

  if (obj.type === "image") {
    // Only touch src when it actually changes; reassigning restarts GIF playback.
    const img = el.firstChild;
    if (img.getAttribute("src") !== obj.src) img.src = obj.src;
  } else {
    styleText(el.firstChild, obj);
  }
}

// Reuses DOM nodes by object id so that animated GIFs keep playing across updates.
export function createRenderer(layer) {
  const elements = new Map();
  return {
    render(objects) {
      const seen = new Set();
      objects.forEach((obj, index) => {
        seen.add(obj.id);
        let el = elements.get(obj.id);
        if (!el || el.dataset.type !== obj.type) {
          el?.remove();
          el = createElement(obj);
          layer.appendChild(el);
          elements.set(obj.id, el);
        }
        applyObject(el, obj, index);
      });
      for (const [id, el] of elements) {
        if (!seen.has(id)) {
          el.remove();
          elements.delete(id);
        }
      }
    },
  };
}

export function connect(role, clientId, handlers) {
  const source = new EventSource(`/api/events?role=${role}&clientId=${clientId}`);
  source.addEventListener("state", (e) => handlers.onState?.(JSON.parse(e.data)));
  source.addEventListener("viewers", (e) => handlers.onViewers?.(JSON.parse(e.data)));
  source.addEventListener("open", () => handlers.onOpen?.());
  return source;
}
